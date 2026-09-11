import type {
  Block,
  BlockRange,
  BlockRepo,
  Repos,
  Tag,
  TagRepo,
  Task,
  TaskFilter,
  TaskRepo,
  TaskTag,
} from '@sigwan/core';
import { makeMockData, nowIso } from '@sigwan/core';
import Dexie, { type EntityTable } from 'dexie';

/**
 * M1의 로컬 저장. 스키마를 명세 5장 그대로 잡아두면 M3의 SQLite(Drizzle)로
 * 거의 그대로 옮겨간다. 8장 Repository 인터페이스를 구현하므로
 * M2에서 Supabase/REST로 갈아끼울 때 화면 코드는 건드리지 않는다.
 */

const USER_ID = 'local-user';

class SigwanDb extends Dexie {
  tasks!: EntityTable<Task, 'id'>;
  blocks!: EntityTable<Block, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  task_tags!: EntityTable<TaskTag & { id: string }, 'id'>;

  constructor() {
    super('sigwan');
    this.version(1).stores({
      tasks: 'id, kind, status, day_of, due_at, parent_id, sort_order, deleted_at, rev',
      blocks: 'id, task_id, start_at, end_at, deleted_at, rev',
      tags: 'id, name, sort_order, deleted_at',
      task_tags: 'id, task_id, tag_id',
    });
  }
}

export const db = new SigwanDb();

/**
 * 첫 실행에 목 데이터를 넣는다 — 없으면 UI 담당들이 빈 화면을 본다 (16.8-4)
 *
 * 두 겹으로 막는다:
 *  1) 모듈 레벨 프로미스 — React StrictMode가 개발 모드에서 effect를 두 번 돌린다.
 *     await 사이에 두 호출이 끼어들면 둘 다 "비어 있음"을 보고 각자 넣어버린다.
 *  2) 트랜잭션 안에서 count를 다시 확인 — 탭이 두 개 열려도 안전하다.
 */
let seeding: Promise<void> | null = null;

export function seedIfEmpty(): Promise<void> {
  if (!seeding) {
    seeding = (async () => {
      await db.transaction('rw', db.tasks, db.blocks, db.tags, db.task_tags, async () => {
        if ((await db.tasks.count()) > 0) return;
        const m = makeMockData(new Date());
        await db.tags.bulkAdd(m.tags);
        await db.tasks.bulkAdd(m.tasks);
        await db.blocks.bulkAdd(m.blocks);
        await db.task_tags.bulkAdd(
          m.taskTags.map((tt) => ({ ...tt, id: `${tt.task_id}:${tt.tag_id}` })),
        );
      });
    })().catch((e) => {
      seeding = null;
      throw e;
    });
  }
  return seeding;
}

export async function resetAll(): Promise<void> {
  seeding = null;
  await db.delete();
  await db.open();
  await seedIfEmpty();
}

const arr = <T>(v: T | T[] | undefined): T[] | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v : [v];

class LocalTaskRepo implements TaskRepo {
  async list(filter: TaskFilter = {}): Promise<Task[]> {
    let rows = await db.tasks.toArray();
    if (!filter.includeDeleted) rows = rows.filter((t) => !t.deleted_at);
    const kinds = arr(filter.kind);
    if (kinds) rows = rows.filter((t) => kinds.includes(t.kind));
    const statuses = arr(filter.status);
    if (statuses) rows = rows.filter((t) => statuses.includes(t.status));
    if (filter.dayOf) rows = rows.filter((t) => t.day_of === filter.dayOf);
    if (filter.dueFrom) rows = rows.filter((t) => !!t.due_at && t.due_at >= filter.dueFrom!);
    if (filter.dueTo) rows = rows.filter((t) => !!t.due_at && t.due_at <= filter.dueTo!);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      rows = rows.filter(
        (t) => t.title.toLowerCase().includes(q) || (t.notes ?? '').toLowerCase().includes(q),
      );
    }
    if (filter.tagIds?.length) {
      const links = await db.task_tags.toArray();
      const allowed = new Set(
        links.filter((l) => filter.tagIds!.includes(l.tag_id)).map((l) => l.task_id),
      );
      rows = rows.filter((t) => allowed.has(t.id));
    }
    return rows;
  }

  async get(id: string) {
    return (await db.tasks.get(id)) ?? null;
  }

  async upsert(task: Task) {
    const next = { ...task, user_id: USER_ID, updated_at: nowIso(), rev: task.rev + 1 };
    await db.tasks.put(next);
    return next;
  }

  async upsertMany(tasks: Task[]) {
    await db.tasks.bulkPut(tasks.map((t) => ({ ...t, user_id: USER_ID })));
  }

  /** 툼스톤 — 물리 삭제하지 않는다 (7장) */
  async remove(id: string) {
    const t = await db.tasks.get(id);
    if (!t) return;
    await db.tasks.put({ ...t, deleted_at: nowIso(), updated_at: nowIso(), rev: t.rev + 1 });
  }

  async syncSince(rev: number) {
    const tasks = await db.tasks.where('rev').above(rev).toArray();
    const max = tasks.reduce((m, t) => Math.max(m, t.rev), rev);
    return { tasks, rev: max };
  }
}

class LocalBlockRepo implements BlockRepo {
  async list(range: BlockRange) {
    const rows = await db.blocks.toArray();
    return rows.filter((b) => !b.deleted_at && b.end_at > range.from && b.start_at < range.to);
  }
  async listByTask(taskId: string) {
    return (await db.blocks.where('task_id').equals(taskId).toArray()).filter((b) => !b.deleted_at);
  }
  async upsert(block: Block) {
    const next = { ...block, user_id: USER_ID, rev: block.rev + 1 };
    await db.blocks.put(next);
    return next;
  }
  async remove(id: string) {
    const b = await db.blocks.get(id);
    if (!b) return;
    await db.blocks.put({ ...b, deleted_at: nowIso(), rev: b.rev + 1 });
  }
}

class LocalTagRepo implements TagRepo {
  async list() {
    return (await db.tags.toArray()).filter((t) => !t.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
  }
  async upsert(tag: Tag) {
    const next = { ...tag, user_id: USER_ID, rev: tag.rev + 1 };
    await db.tags.put(next);
    return next;
  }
  async remove(id: string) {
    const t = await db.tags.get(id);
    if (!t) return;
    await db.tags.put({ ...t, deleted_at: nowIso(), rev: t.rev + 1 });
  }
  async setTaskTags(taskId: string, tagIds: string[]) {
    await db.task_tags.where('task_id').equals(taskId).delete();
    await db.task_tags.bulkAdd(
      tagIds.map((tag_id) => ({ id: `${taskId}:${tag_id}`, task_id: taskId, tag_id })),
    );
  }
  async tagsOf(taskId: string) {
    const links = await db.task_tags.where('task_id').equals(taskId).toArray();
    const tags = await db.tags.bulkGet(links.map((l) => l.tag_id));
    // 툼스톤된 태그는 안 돌려준다 — 안 그러면 지운 태그가 할 일 줄에 계속 보인다
    return tags.filter((t): t is Tag => !!t && !t.deleted_at);
  }
}

export const repos: Repos = {
  tasks: new LocalTaskRepo(),
  blocks: new LocalBlockRepo(),
  tags: new LocalTagRepo(),
};

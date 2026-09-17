import type {
  Block,
  BlockRange,
  BlockRepo,
  Repos,
  Routine,
  RoutineCheck,
  RoutineCheckRepo,
  RoutineRepo,
  Settings,
  SettingsRepo,
  Tag,
  TagRepo,
  Task,
  TaskFilter,
  TaskRepo,
  TaskTag,
} from '@sigwan/core';
import { checkKey, makeMockData, nowIso } from '@sigwan/core';
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
  routines!: EntityTable<Routine, 'id'>;
  routine_checks!: EntityTable<RoutineCheck, 'id'>;
  /** 사용자당 한 행이라 기본키가 user_id다 */
  settings!: EntityTable<Settings, 'user_id'>;

  constructor() {
    super('sigwan');
    this.version(1).stores({
      tasks: 'id, kind, status, day_of, due_at, parent_id, sort_order, deleted_at, rev',
      blocks: 'id, task_id, start_at, end_at, deleted_at, rev',
      tags: 'id, name, sort_order, deleted_at',
      task_tags: 'id, task_id, tag_id',
    });
    // 3.8 고정 일정·수면. 기존 테이블은 그대로 두고 두 개만 더한다.
    this.version(2).stores({
      routines: 'id, deleted_at, rev',
      settings: 'user_id',
    });
    // 고정 일정 체크. day에 인덱스가 있어야 화면에 보이는 기간만 읽어온다
    this.version(3).stores({
      routine_checks: 'id, routine_id, day, deleted_at, rev',
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
  /** 툼스톤된 것까지 본다 — 앱 SQLite의 UNIQUE(user_id, name)와 같은 규칙을 지킨다 */
  async findByName(name: string) {
    const rows = await db.tags.where('name').equals(name).toArray();
    return rows[0] ?? null;
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

/** 3.8 — 주 단위 규칙이라 범위 조회가 없다. 전부 읽어서 화면에서 펼친다 */
class LocalRoutineRepo implements RoutineRepo {
  async list() {
    return (await db.routines.toArray())
      .filter((r) => !r.deleted_at)
      .sort((a, b) => a.start_min - b.start_min || a.name.localeCompare(b.name));
  }
  async upsert(r: Routine) {
    const next = { ...r, user_id: USER_ID, rev: r.rev + 1 };
    await db.routines.put(next);
    return next;
  }
  async remove(id: string) {
    const r = await db.routines.get(id);
    if (!r) return;
    // 툼스톤 — 지운 수업이 지난 주 화면에서까지 사라지면 기록이 틀어진다 (7장)
    await db.routines.put({ ...r, deleted_at: nowIso(), rev: r.rev + 1 });
  }
}

class LocalRoutineCheckRepo implements RoutineCheckRepo {
  async listRange(from: string, to: string) {
    const rows = await db.routine_checks.where('day').between(from, to, true, true).toArray();
    return rows.filter((c) => !c.deleted_at);
  }
  /**
   * id를 계산해서 쓰므로 같은 날 같은 일정에 두 줄이 생기지 않는다.
   * 해제는 물리 삭제가 아니라 툼스톤 — 다른 기기에 "지웠다"를 전해야 한다 (7장).
   */
  async toggle(routineId: string, day: string) {
    const id = checkKey(routineId, day);
    const cur = await db.routine_checks.get(id);
    const next: RoutineCheck = cur
      ? { ...cur, checked_at: nowIso(), deleted_at: cur.deleted_at ? null : nowIso(), rev: cur.rev + 1 }
      : {
          id,
          user_id: USER_ID,
          routine_id: routineId,
          day,
          checked_at: nowIso(),
          deleted_at: null,
          rev: 0,
        };
    await db.routine_checks.put(next);
    return next;
  }
}

class LocalSettingsRepo implements SettingsRepo {
  async get() {
    return (await db.settings.get(USER_ID)) ?? null;
  }
  async save(s: Settings) {
    const next = { ...s, user_id: USER_ID, updated_at: nowIso(), rev: s.rev + 1 };
    await db.settings.put(next);
    return next;
  }
}

export const repos: Repos = {
  tasks: new LocalTaskRepo(),
  blocks: new LocalBlockRepo(),
  tags: new LocalTagRepo(),
  routines: new LocalRoutineRepo(),
  routineChecks: new LocalRoutineCheckRepo(),
  settings: new LocalSettingsRepo(),
};

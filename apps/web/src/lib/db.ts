import type {
  Block,
  BlockRange,
  BlockRepo,
  OutboxEntry,
  Repos,
  Routine,
  RoutineCheck,
  RoutineCheckRepo,
  RoutineRepo,
  Settings,
  SettingsRepo,
  SyncTable,
  Tag,
  TagRepo,
  Task,
  TaskFilter,
  TaskRepo,
  TaskTag,
  TaskTagsPayload,
  Timetable,
  TimetableRepo,
} from '@sigwan/core';
import type { DemoIds } from '@sigwan/core';
import {
  checkKey,
  DEMO_IDS_KEY,
  DEMO_STATE_KEY,
  demoIdsOf,
  demoRowsToDelete,
  detectLegacyDemo,
  makeMockData,
  nowIso,
  pendingKey,
} from '@sigwan/core';
import Dexie, { type EntityTable, type Table } from 'dexie';

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
  timetables!: EntityTable<Timetable, 'id'>;
  routines!: EntityTable<Routine, 'id'>;
  routine_checks!: EntityTable<RoutineCheck, 'id'>;
  /** 사용자당 한 행이라 기본키가 user_id다 */
  settings!: EntityTable<Settings, 'user_id'>;
  /** 7장 쓰기 기록. 앱 SQLite의 outbox와 같은 모양 (core/sync.ts) */
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  /** 동기화 커서 같은 기기 전용 값. 서버로 가지 않는다 */
  meta!: EntityTable<{ key: string; value: string }, 'key'>;

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
    /**
     * 시간표 한 벌 (3.8.1). 기간이 일정에서 시간표로 올라갔다.
     * 이미 만든 고정 일정은 「기본」 한 벌에 넣어준다 — 안 그러면 화면에서 통째로 사라진다.
     */
    this.version(4)
      .stores({
        timetables: 'id, deleted_at, rev',
        routines: 'id, timetable_id, deleted_at, rev',
      })
      .upgrade(async (tx) => {
        const rows = await tx.table('routines').toArray();
        if (!rows.length) return;
        const id = 'tt-legacy';
        await tx.table('timetables').put({
          id,
          user_id: USER_ID,
          name: '기본',
          active_from: null,
          active_to: null,
          deleted_at: null,
          rev: 0,
        });
        await tx.table('routines').bulkPut(rows.map((r) => ({ ...r, timetable_id: id })));
      });
    /**
     * M2 준비. 쓰기마다 outbox에 한 줄 남기고(앱과 같은 모양), 모든 동기화 대상에 updated_at을 둔다.
     * 할 일·설정 말고는 updated_at이 없었다 — 7장 LWW가 비교할 값이 없었던 것이다.
     */
    this.version(5)
      .stores({ outbox: '++seq, table_name', meta: 'key' })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        for (const t of ['blocks', 'tags', 'timetables', 'routines', 'routine_checks']) {
          await tx
            .table(t)
            .toCollection()
            .modify((r: { updated_at?: string }) => {
              if (!r.updated_at) r.updated_at = now;
            });
        }
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
      await db.transaction('rw', [db.tasks, db.blocks, db.tags, db.task_tags, db.meta], async () => {
        // 예시를 이미 넣었거나 지웠다 — 다시 넣지 않는다
        if (await db.meta.get(DEMO_STATE_KEY)) return;

        if ((await db.tasks.count()) > 0) {
          // 예시 id를 적어 두기 전에 깔린 기기. 예시 행을 찾아서 적는다 (core/demo.ts)
          const ids = detectLegacyDemo({
            tasks: await db.tasks.toArray(),
            blocks: await db.blocks.toArray(),
            tags: await db.tags.toArray(),
            taskTags: await db.task_tags.toArray(),
          });
          await markDemo(ids, ids.tasks.length ? 'shown' : 'cleared');
          return;
        }

        const m = makeMockData(new Date());
        await db.tags.bulkAdd(m.tags);
        await db.tasks.bulkAdd(m.tasks);
        await db.blocks.bulkAdd(m.blocks);
        await db.task_tags.bulkAdd(
          m.taskTags.map((tt) => ({ ...tt, id: `${tt.task_id}:${tt.tag_id}` })),
        );
        await markDemo(demoIdsOf(m), 'shown');
      });
    })().catch((e) => {
      seeding = null;
      throw e;
    });
  }
  return seeding;
}

export async function resetAll(): Promise<void> {
  await wipeLocal();
  await seedIfEmpty();
}

/** 로그아웃 — 이 기기의 데이터를 전부 지운다. 다음에 열면 처음처럼 예시가 보인다 */
export async function wipeLocal(): Promise<void> {
  seeding = null;
  await db.delete();
  await db.open();
}

async function markDemo(ids: DemoIds, state: 'shown' | 'cleared') {
  await db.meta.bulkPut([
    { key: DEMO_IDS_KEY, value: JSON.stringify(ids) },
    { key: DEMO_STATE_KEY, value: state },
  ]);
}

/**
 * 예시 데이터를 치운다 — 직접 뭔가를 처음 등록할 때, 그리고 로그인할 때.
 * 예시를 고친 outbox 기록도 같이 지운다 — 예시는 서버로 가면 안 된다.
 * 지운 id를 돌려준다(화면 상태에서도 빼야 한다). 이미 치웠으면 null.
 */
export async function clearDemo(): Promise<DemoIds | null> {
  return db.transaction('rw', [db.tasks, db.blocks, db.tags, db.task_tags, db.outbox, db.meta], async () => {
    if ((await db.meta.get(DEMO_STATE_KEY))?.value !== 'shown') return null;
    const raw = await db.meta.get(DEMO_IDS_KEY);
    const ids: DemoIds = raw ? JSON.parse(raw.value) : { tasks: [], blocks: [], tags: [] };
    const links = await db.task_tags.toArray();
    const del = demoRowsToDelete(ids, {
      tasks: await db.tasks.toArray(),
      blocks: await db.blocks.toArray(),
      taskTags: links,
    });
    const dt = new Set(del.tasks);
    const dg = new Set(del.tags);
    await db.tasks.bulkDelete(del.tasks);
    await db.blocks.bulkDelete(del.blocks);
    await db.tags.bulkDelete(del.tags);
    await db.task_tags.bulkDelete(links.filter((l) => dt.has(l.task_id) || dg.has(l.tag_id)).map((l) => l.id));

    const keys = new Set([
      ...del.tasks.flatMap((id) => [pendingKey('tasks', id), pendingKey('task_tags', id)]),
      ...del.blocks.map((id) => pendingKey('blocks', id)),
      ...del.tags.map((id) => pendingKey('tags', id)),
    ]);
    const ob = await db.outbox.toArray();
    await db.outbox.bulkDelete(ob.filter((e) => keys.has(pendingKey(e.table_name, e.row_id))).map((e) => e.seq));

    await markDemo({ tasks: [], blocks: [], tags: [] }, 'cleared');
    return del;
  });
}

/**
 * 처음 로그인할 때 — 이 기기의 행 전체를 outbox에 다시 적는다. 로그인 전에 쓴 것은 outbox에 일부만 있거나
 * (예시를 지우기 전 것) 아예 없을 수 있다. 예시는 먼저 치운다(clearDemo). 적은 줄 수를 돌려준다.
 */
export async function enqueueAll(): Promise<number> {
  await clearDemo();
  const tables = [db.tasks, db.blocks, db.tags, db.task_tags, db.timetables, db.routines, db.routine_checks, db.settings];
  return db.transaction('rw', [...tables, db.outbox, db.meta], async () => {
    await db.outbox.clear();
    let n = 0;
    const each = async <R extends { id: string }>(name: SyncTable, rows: R[]) => {
      for (const r of rows) {
        await logOutbox(name, r.id, r);
        n++;
      }
    };
    await each('tasks', await db.tasks.toArray());
    await each('blocks', await db.blocks.toArray());
    await each('tags', await db.tags.toArray());
    await each('timetables', await db.timetables.toArray());
    await each('routines', await db.routines.toArray());
    await each('routine_checks', await db.routine_checks.toArray());
    const byTask = new Map<string, string[]>();
    for (const l of await db.task_tags.toArray()) byTask.set(l.task_id, [...(byTask.get(l.task_id) ?? []), l.tag_id]);
    for (const [taskId, tagIds] of byTask) {
      const payload: TaskTagsPayload = { task_id: taskId, tag_ids: tagIds, updated_at: nowIso() };
      await logOutbox('task_tags', taskId, payload);
      n++;
    }
    for (const s of await db.settings.toArray()) {
      await logOutbox('settings', s.user_id, s);
      n++;
    }
    return n;
  });
}

/**
 * 쓰기 한 건 = 행 저장 + outbox 한 줄. 한 트랜잭션이라 "저장은 됐는데 기록이 없어 서버에 영영 안 올라가는"
 * 상태가 생기지 않는다 (7장). 삭제도 툼스톤 행을 쓰는 것이라 op는 늘 upsert다.
 */
async function write<R>(table: Table, name: SyncTable, row: R, rowId: string): Promise<R> {
  await db.transaction('rw', table, db.outbox, db.meta, async () => {
    await table.put(row);
    await logOutbox(name, rowId, row);
  });
  return row;
}

export const CURSOR_KEY = 'sync_cursor';

/**
 * outbox 한 줄. base_rev는 지금의 커서 — "서버 것을 여기까지 받아 둔 상태에서 고쳤다"는 표시다.
 * 서버는 이걸로 최신을 보고 고친 것인지, 모르고 동시에 고친 충돌인지 가른다 (core/sync.ts)
 */
async function logOutbox(name: SyncTable, rowId: string, payload: unknown) {
  const cursor = await db.meta.get(CURSOR_KEY);
  await db.outbox.add({
    table_name: name,
    row_id: rowId,
    op: 'upsert',
    payload: JSON.stringify(payload),
    created_at: nowIso(),
    base_rev: cursor ? Number(cursor.value) : 0,
  } as OutboxEntry);
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
    return write(db.tasks, 'tasks', next, next.id);
  }

  async upsertMany(tasks: Task[]) {
    for (const t of tasks) await this.upsert(t);
  }

  /** 툼스톤 — 물리 삭제하지 않는다 (7장) */
  async remove(id: string) {
    const t = await db.tasks.get(id);
    if (!t) return;
    await this.upsert({ ...t, deleted_at: nowIso() });
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
    const next = { ...block, user_id: USER_ID, updated_at: nowIso(), rev: block.rev + 1 };
    return write(db.blocks, 'blocks', next, next.id);
  }
  async remove(id: string) {
    const b = await db.blocks.get(id);
    if (!b) return;
    await this.upsert({ ...b, deleted_at: nowIso() });
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
    const next = { ...tag, user_id: USER_ID, updated_at: nowIso(), rev: tag.rev + 1 };
    return write(db.tags, 'tags', next, next.id);
  }
  async remove(id: string) {
    const t = await db.tags.get(id);
    if (!t) return;
    await this.upsert({ ...t, deleted_at: nowIso() });
  }
  async setTaskTags(taskId: string, tagIds: string[]) {
    const payload: TaskTagsPayload = { task_id: taskId, tag_ids: tagIds, updated_at: nowIso() };
    await db.transaction('rw', db.task_tags, db.outbox, db.meta, async () => {
      await db.task_tags.where('task_id').equals(taskId).delete();
      await db.task_tags.bulkAdd(
        tagIds.map((tag_id) => ({ id: `${taskId}:${tag_id}`, task_id: taskId, tag_id })),
      );
      await logOutbox('task_tags', taskId, payload);
    });
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
    const next = { ...r, user_id: USER_ID, updated_at: nowIso(), rev: r.rev + 1 };
    return write(db.routines, 'routines', next, next.id);
  }
  async remove(id: string) {
    const r = await db.routines.get(id);
    if (!r) return;
    // 툼스톤 — 지운 수업이 지난 주 화면에서까지 사라지면 기록이 틀어진다 (7장)
    await this.upsert({ ...r, deleted_at: nowIso() });
  }
}

class LocalTimetableRepo implements TimetableRepo {
  async list() {
    return (await db.timetables.toArray())
      .filter((t) => !t.deleted_at)
      .sort((a, b) => (b.active_from ?? '').localeCompare(a.active_from ?? '') || a.name.localeCompare(b.name));
  }
  async upsert(t: Timetable) {
    const next = { ...t, user_id: USER_ID, updated_at: nowIso(), rev: t.rev + 1 };
    return write(db.timetables, 'timetables', next, next.id);
  }
  async remove(id: string) {
    const t = await db.timetables.get(id);
    if (!t) return;
    await this.upsert({ ...t, deleted_at: nowIso() });
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
      ? {
          ...cur,
          checked_at: nowIso(),
          deleted_at: cur.deleted_at ? null : nowIso(),
          updated_at: nowIso(),
          rev: cur.rev + 1,
        }
      : {
          id,
          user_id: USER_ID,
          routine_id: routineId,
          day,
          checked_at: nowIso(),
          deleted_at: null,
          updated_at: nowIso(),
          rev: 0,
        };
    return write(db.routine_checks, 'routine_checks', next, next.id);
  }
}

class LocalSettingsRepo implements SettingsRepo {
  async get() {
    return (await db.settings.get(USER_ID)) ?? null;
  }
  async save(s: Settings) {
    const next = { ...s, user_id: USER_ID, updated_at: nowIso(), rev: s.rev + 1 };
    return write(db.settings, 'settings', next, next.user_id);
  }
}

export const repos: Repos = {
  tasks: new LocalTaskRepo(),
  blocks: new LocalBlockRepo(),
  tags: new LocalTagRepo(),
  timetables: new LocalTimetableRepo(),
  routines: new LocalRoutineRepo(),
  routineChecks: new LocalRoutineCheckRepo(),
  settings: new LocalSettingsRepo(),
};

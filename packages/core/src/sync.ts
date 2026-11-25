/**
 * 7장 동기화 — 기기에 쌓는 쓰기 기록(outbox)의 모양.
 *
 * 웹(Dexie)과 앱(SQLite)이 **같은 모양으로** 쌓는다. M2의 동기화 엔진은 이 모양만 알면
 * 어느 쪽 기록이든 서버로 올릴 수 있다.
 *
 * 삭제도 툼스톤(deleted_at을 찍은 행)이라 op는 사실상 늘 'upsert'다. 'delete'는
 * 물리 삭제가 필요한 경우(계정 삭제 등)를 위해 남겨 둔 자리다.
 */

export const SYNC_TABLES = [
  'tasks',
  'blocks',
  'tags',
  'task_tags',
  'timetables',
  'routines',
  'routine_checks',
  'settings',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export interface OutboxEntry {
  /** 쌓인 순서. 서버에도 이 순서대로 올린다 */
  seq: number;
  table_name: SyncTable;
  /** 행의 id. settings는 user_id, task_tags는 task_id */
  row_id: string;
  op: 'upsert' | 'delete';
  /** 그 순간의 행 전체를 JSON으로. task_tags는 TaskTagsPayload */
  payload: string;
  created_at: string;
  /** 기록할 때의 커서(어디까지 받아 둔 상태에서 고쳤나). 서버의 충돌 판정에 쓴다 — PushChange.base_rev */
  base_rev?: number | null;
}

/**
 * 할 일 하나에 붙은 태그 **전체**. 연결 한 줄씩이 아니라 통째로 갈아끼운다 —
 * 폰에서 하나 떼고 웹에서 하나 붙이면 둘 중 나중 것이 이긴다(LWW, updated_at 기준).
 */
export interface TaskTagsPayload {
  task_id: string;
  tag_ids: string[];
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 동기화 엔진 (M2 3단계). 서버(supabase/migrations)의 sync_push / sync_pull과 짝이다.
// ─────────────────────────────────────────────────────────────────────────────

/** 서버로 보내는 변경 한 건 */
export interface PushChange {
  seq: number;
  table: SyncTable;
  row: unknown;
  /**
   * 이 변경을 기록할 때 기기가 어디까지 받아 둔 상태였나(커서). 서버는 이 값보다 나중에 바뀐 행일 때만
   * 충돌로 보고 7장 규칙(LWW · done 우선 · spent_min 최대)을 쓴다. 그 밖엔 그대로 반영한다
   */
  base_rev?: number;
}

export interface PushResult {
  applied: number[];
  rejected: { seq: number; error: string }[];
  rev: number;
}

export interface PullChange {
  table: SyncTable;
  row: Record<string, unknown>;
}

export interface PullResult {
  changes: PullChange[];
  rev: number;
  more: boolean;
}

/** 서버 쪽. Supabase든 시험용 가짜든 이 두 함수면 된다 */
export interface SyncServer {
  push(changes: PushChange[]): Promise<PushResult>;
  pull(since: number): Promise<PullResult>;
}

/** 기기 쪽. 웹(Dexie)과 앱(SQLite)이 각자 구현한다 */
export interface SyncLocal {
  /** seq 순으로 앞에서부터 */
  readOutbox(limit: number): Promise<OutboxEntry[]>;
  deleteOutbox(seqs: number[]): Promise<void>;
  /** 아직 안 올린 변경이 있는 행. `${table}:${row_id}` */
  pendingKeys(): Promise<Set<string>>;
  getCursor(): Promise<number>;
  /**
   * 받은 행을 로컬에 넣고 커서를 옮긴다 — **한 트랜잭션으로.** 행만 들어가고 커서가 안 옮겨지면 다음에
   * 같은 것을 또 받을 뿐이지만, 커서만 옮겨지고 행이 빠지면 그 변경은 영영 안 온다.
   * outbox에는 남기지 않는다 (남기면 받은 것을 도로 올린다)
   */
  applyRemote(changes: PullChange[], rev: number): Promise<void>;
  /** 서버가 거절한 변경. 지우기 전에 남겨 둔다 — 조용히 사라지면 원인을 못 찾는다 */
  onRejected(entries: OutboxEntry[], errors: { seq: number; error: string }[]): Promise<void>;
}

/** 로컬에 넣을 때 쓰는 주인. 기기 하나에 한 사람이다 — 서버의 진짜 id는 로컬이 몰라도 된다 */
export const LOCAL_USER = 'local-user';

/** 시각 열. 서버는 '…+00:00'으로 돌려주는데 로컬은 '…Z'로 쓰고 문자열로 비교한다 (기간 조회) */
const TIME_FIELDS: Record<SyncTable, string[]> = {
  tasks: ['start_at', 'due_at', 'created_at', 'updated_at', 'completed_at', 'deleted_at'],
  blocks: ['start_at', 'end_at', 'updated_at', 'deleted_at'],
  tags: ['updated_at', 'deleted_at'],
  task_tags: ['updated_at'],
  timetables: ['updated_at', 'deleted_at'],
  routines: ['updated_at', 'deleted_at'],
  routine_checks: ['checked_at', 'updated_at', 'deleted_at'],
  settings: ['updated_at'],
};

/** 서버에서 받은 행을 로컬 모양으로. 시각은 '…Z'로, 주인은 LOCAL_USER로, 로컬 전용 rev는 0에서 */
export function normalizeRemoteRow(table: SyncTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  delete out.server_rev;
  for (const f of TIME_FIELDS[table]) {
    const v = out[f];
    if (typeof v === 'string') out[f] = new Date(v).toISOString();
  }
  if (table === 'task_tags') return out;
  out.user_id = LOCAL_USER;
  if (table !== 'settings') out.rev = 0;
  return out;
}

/** outbox 한 줄이 가리키는 행의 키. pendingKeys와 같은 모양 */
export const pendingKey = (table: SyncTable, rowId: string) => `${table}:${rowId}`;

/** 받은 변경의 행 키 — settings는 사용자당 한 행이라 LOCAL_USER, task_tags는 task_id */
function remoteKey(c: PullChange): string {
  const id =
    c.table === 'settings' ? LOCAL_USER : c.table === 'task_tags' ? String(c.row.task_id) : String(c.row.id);
  return pendingKey(c.table, id);
}

export interface SyncReport {
  pushed: number;
  rejected: number;
  pulled: number;
  /** 아직 안 올린 로컬 변경이 있어 덮지 않고 건너뛴 행 */
  skipped: number;
  rev: number;
}

const PUSH_BATCH = 500;

/**
 * 한 바퀴 — **올리고 나서 받는다.** 반대로 하면 아직 안 올린 로컬 변경 위에 서버 것을 덮어쓰게 된다.
 * 올린 행은 서버에서 번호가 올라 받기에서 다시 내려온다 — 서버가 충돌을 정리한 결과가 그렇게 로컬에 온다.
 */
export async function syncOnce(local: SyncLocal, server: SyncServer): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, rejected: 0, pulled: 0, skipped: 0, rev: 0 };

  // ── 올리기 ──
  for (;;) {
    const entries = await local.readOutbox(PUSH_BATCH);
    if (entries.length === 0) break;
    const res = await server.push(
      entries.map((e) => ({
        seq: e.seq,
        table: e.table_name,
        row: JSON.parse(e.payload),
        ...(e.base_rev != null ? { base_rev: e.base_rev } : {}),
      })),
    );
    if (res.rejected.length) {
      const bad = new Set(res.rejected.map((r) => r.seq));
      await local.onRejected(
        entries.filter((e) => bad.has(e.seq)),
        res.rejected,
      );
    }
    const done = [...res.applied, ...res.rejected.map((r) => r.seq)];
    await local.deleteOutbox(done);
    report.pushed += res.applied.length;
    report.rejected += res.rejected.length;
    // 서버가 아무것도 처리하지 않았다면 같은 줄을 또 보내 봐야 같다 — 무한 반복하지 않는다
    if (done.length === 0) throw new Error('sync_push가 아무 변경도 처리하지 않았다');
    if (entries.length < PUSH_BATCH) break;
  }

  // ── 받기 ──
  let cursor = await local.getCursor();
  for (;;) {
    const res = await server.pull(cursor);
    // 올리는 사이 화면에서 새로 고친 행은 덮지 않는다. 다음 바퀴에 올라가고, 서버가 정리한 결과가 다시 온다
    const pending = await local.pendingKeys();
    const take: PullChange[] = [];
    for (const c of res.changes) {
      if (pending.has(remoteKey(c))) report.skipped++;
      else take.push({ table: c.table, row: normalizeRemoteRow(c.table, c.row) });
    }
    await local.applyRemote(take, res.rev);
    report.pulled += take.length;
    cursor = res.rev;
    if (!res.more) break;
  }
  report.rev = cursor;
  return report;
}

/**
 * Supabase에 붙이는 SyncServer. supabase-js에 의존하지 않으려고 rpc 함수만 받는다 —
 * `createSupabaseServer((fn, args) => supabase.rpc(fn, args))`
 */
export function createSupabaseServer(
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): SyncServer {
  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
  return {
    push: (changes) => call<PushResult>('sync_push', { changes }),
    pull: (since) => call<PullResult>('sync_pull', { since }),
  };
}

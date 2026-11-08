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

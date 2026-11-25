import type { OutboxEntry, PullChange, SyncLocal, SyncTable, TaskTagsPayload } from '@sigwan/core';
import { nowIso, pendingKey } from '@sigwan/core';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  CURSOR_KEY,
  outbox,
  repos,
  rowToBlock,
  rowToCheck,
  rowToRoutine,
  rowToTag,
  rowToTask,
  rowToTimetable,
} from './repos';
import { clearDemo, getDb, withWrite } from './sqlite';

/**
 * core/syncOnce가 쓰는 기기 쪽 — SQLite 판. 웹 Dexie 판(apps/web/src/lib/sync.ts)과 1:1.
 *
 * 받은 행은 레포를 거치지 않고 테이블에 바로 넣는다. 레포로 넣으면 outbox에 남아 받은 것을 도로 올린다.
 * 열 이름은 PRAGMA로 읽어서 로컬에 있는 열만 넣는다 — 서버에만 있는 열이 생겨도 여기서 깨지지 않는다.
 */

const REJECTED_KEY = 'sync_rejected';
const REJECTED_KEEP = 50;

const columnsCache = new Map<string, Set<string>>();
async function columnsOf(db: SQLiteDatabase, table: string) {
  let cols = columnsCache.get(table);
  if (!cols) {
    const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    cols = new Set(rows.map((r) => r.name));
    columnsCache.set(table, cols);
  }
  return cols;
}

/** SQLite에 넣을 값으로. 불리언 0/1, 요일 배열 '0,2', 객체(수면)는 JSON */
function toSql(table: SyncTable, key: string, v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (table === 'routines' && key === 'weekdays' && Array.isArray(v)) return [...v].sort((a, b) => a - b).join(',');
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export const sqliteSyncLocal: SyncLocal = {
  async readOutbox(limit) {
    const db = await getDb();
    return db.getAllAsync<OutboxEntry>(
      'SELECT seq, table_name, row_id, op, payload, created_at, base_rev FROM outbox ORDER BY seq LIMIT ?',
      limit,
    );
  },

  async deleteOutbox(seqs) {
    if (!seqs.length) return;
    await withWrite(async (db) => {
      await db.runAsync(`DELETE FROM outbox WHERE seq IN (${seqs.map(() => '?').join(',')})`, ...seqs);
    });
  },

  async pendingKeys() {
    const db = await getDb();
    const rows = await db.getAllAsync<{ table_name: SyncTable; row_id: string }>('SELECT table_name, row_id FROM outbox');
    return new Set(rows.map((r) => pendingKey(r.table_name, r.row_id)));
  },

  async getCursor() {
    const db = await getDb();
    const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', CURSOR_KEY);
    return r ? Number(r.value) : 0;
  },

  async applyRemote(changes: PullChange[], rev: number) {
    await withWrite(async (db) => {
      for (const c of changes) {
        if (c.table === 'task_tags') {
          const taskId = String(c.row.task_id);
          await db.runAsync('DELETE FROM task_tags WHERE task_id = ?', taskId);
          for (const tagId of (c.row.tag_ids as string[] | undefined) ?? []) {
            await db.runAsync('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)', taskId, tagId);
          }
          continue;
        }
        const cols = await columnsOf(db, c.table);
        const keys = Object.keys(c.row).filter((k) => cols.has(k));
        await db.runAsync(
          `INSERT OR REPLACE INTO ${c.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
          ...(keys.map((k) => toSql(c.table, k, c.row[k])) as never[]),
        );
      }
      await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', CURSOR_KEY, String(rev));
    });
  },

  async onRejected(entries, errors) {
    console.warn('[sync] 서버가 거절한 변경', errors);
    const db = await getDb();
    const prev = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', REJECTED_KEY);
    const list = prev ? (JSON.parse(prev.value) as unknown[]) : [];
    const byseq = new Map(errors.map((e) => [e.seq, e.error]));
    list.push(...entries.map((e) => ({ ...e, error: byseq.get(e.seq), at: new Date().toISOString() })));
    await withWrite(async (tx) => {
      await tx.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', REJECTED_KEY, JSON.stringify(list.slice(-REJECTED_KEEP)));
    });
  },
};

/**
 * 처음 로그인할 때 — 이 기기의 행 전체를 outbox에 다시 적는다. 로그인 전에 쓴 것은 outbox에 일부만 있거나
 * (예시를 지우기 전 것) 아예 없을 수 있다. 예시는 먼저 치운다(clearDemo). 적은 줄 수를 돌려준다.
 */
export async function enqueueAll(): Promise<number> {
  await clearDemo();
  const settings = await repos.settings.get();
  return withWrite(async (db) => {
    await db.runAsync('DELETE FROM outbox');
    let n = 0;
    const each = async <R extends { id: string }>(table: SyncTable, sql: string, conv: (r: Record<string, unknown>) => R) => {
      for (const r of await db.getAllAsync<Record<string, unknown>>(sql)) {
        const row = conv(r);
        await outbox(db, table, row.id, 'upsert', row);
        n++;
      }
    };
    await each('tasks', 'SELECT * FROM tasks', rowToTask);
    await each('blocks', 'SELECT * FROM blocks', rowToBlock);
    await each('tags', 'SELECT * FROM tags', rowToTag);
    await each('timetables', 'SELECT * FROM timetables', rowToTimetable);
    await each('routines', 'SELECT * FROM routines', rowToRoutine);
    await each('routine_checks', 'SELECT * FROM routine_checks', rowToCheck);
    const byTask = new Map<string, string[]>();
    for (const l of await db.getAllAsync<{ task_id: string; tag_id: string }>('SELECT task_id, tag_id FROM task_tags')) {
      byTask.set(l.task_id, [...(byTask.get(l.task_id) ?? []), l.tag_id]);
    }
    for (const [taskId, tagIds] of byTask) {
      const payload: TaskTagsPayload = { task_id: taskId, tag_ids: tagIds, updated_at: nowIso() };
      await outbox(db, 'task_tags', taskId, 'upsert', payload);
      n++;
    }
    if (settings) {
      await outbox(db, 'settings', settings.user_id, 'upsert', settings);
      n++;
    }
    return n;
  });
}

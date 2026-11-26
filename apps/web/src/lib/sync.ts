import type { OutboxEntry, PullChange, SyncLocal } from '@sigwan/core';
import { LOCAL_USER, pendingKey } from '@sigwan/core';
import { CURSOR_KEY, db } from './db';

/**
 * core/syncOnce가 쓰는 기기 쪽 — Dexie 판. 앱 SQLite 판(apps/mobile/src/db/sync.ts)과 1:1.
 *
 * 받은 행은 레포를 거치지 않고 테이블에 바로 넣는다. 레포로 넣으면 outbox에 남아 받은 것을 도로 올린다.
 */

const REJECTED_KEY = 'sync_rejected';
const REJECTED_KEEP = 50;

export const dexieSyncLocal: SyncLocal = {
  async readOutbox(limit) {
    return db.outbox.orderBy('seq').limit(limit).toArray();
  },

  async deleteOutbox(seqs) {
    await db.outbox.bulkDelete(seqs);
  },

  async pendingKeys() {
    const rows = await db.outbox.toArray();
    return new Set(rows.map((e) => pendingKey(e.table_name, e.row_id)));
  },

  async getCursor() {
    const m = await db.meta.get(CURSOR_KEY);
    return m ? Number(m.value) : 0;
  },

  async applyRemote(changes: PullChange[], rev: number) {
    const tables = [
      db.tasks, db.blocks, db.tags, db.task_tags, db.timetables,
      db.routines, db.routine_checks, db.settings, db.meta,
    ];
    await db.transaction('rw', tables, async () => {
      for (const c of changes) {
        const row = c.row as never;
        switch (c.table) {
          case 'tasks': await db.tasks.put(row); break;
          case 'blocks': await db.blocks.put(row); break;
          case 'tags': await db.tags.put(row); break;
          case 'timetables': await db.timetables.put(row); break;
          case 'routines': await db.routines.put(row); break;
          case 'routine_checks': await db.routine_checks.put(row); break;
          case 'settings': await db.settings.put({ ...(c.row as object), user_id: LOCAL_USER } as never); break;
          case 'task_tags': {
            const taskId = String(c.row.task_id);
            const tagIds = (c.row.tag_ids as string[] | undefined) ?? [];
            await db.task_tags.where('task_id').equals(taskId).delete();
            await db.task_tags.bulkAdd(tagIds.map((tag_id) => ({ id: `${taskId}:${tag_id}`, task_id: taskId, tag_id })));
            break;
          }
        }
      }
      await db.meta.put({ key: CURSOR_KEY, value: String(rev) });
    });
  },

  async onRejected(entries: OutboxEntry[], errors) {
    console.warn('[sync] 서버가 거절한 변경', errors);
    const prev = await db.meta.get(REJECTED_KEY);
    const list = prev ? (JSON.parse(prev.value) as unknown[]) : [];
    const byseq = new Map(errors.map((e) => [e.seq, e.error]));
    list.push(...entries.map((e) => ({ ...e, error: byseq.get(e.seq), at: new Date().toISOString() })));
    await db.meta.put({ key: REJECTED_KEY, value: JSON.stringify(list.slice(-REJECTED_KEEP)) });
  },
};

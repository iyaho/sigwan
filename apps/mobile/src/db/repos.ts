import type { Block, BlockRange, BlockRepo, Repos, Tag, TagRepo, Task, TaskFilter, TaskRepo } from '@sigwan/core';
import { nowIso } from '@sigwan/core';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from './sqlite';

/**
 * core/repo.ts 인터페이스의 SQLite 구현. 웹 Dexie 판(apps/web/src/lib/db.ts)과 1:1.
 *
 * 10.1 — user_id는 여기서만 붙인다. 화면 코드가 권한 조건을 쓰는 순간 다섯 명이 다섯 번 실수한다.
 * 7장 — 모든 쓰기는 outbox에 남긴다. 서버가 없어도 이 습관이 있어야 M2가 '레포 하나 추가'로 끝난다.
 */

const USER_ID = 'local-user'; // 게스트 모드. 로그인이 붙으면 세션의 uid로 바뀐다

type Row = Record<string, unknown>;

const b = (v: unknown) => v === 1 || v === true;

function rowToTask(r: Row): Task {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    title: r.title as string,
    notes: (r.notes as string | null) ?? null,
    kind: r.kind as Task['kind'],
    status: r.status as Task['status'],
    day_of: (r.day_of as string | null) ?? null,
    start_at: (r.start_at as string | null) ?? null,
    due_at: (r.due_at as string | null) ?? null,
    estimate_min: r.estimate_min as number,
    spent_min: r.spent_min as number,
    importance: r.importance as number,
    progress: r.progress as number,
    pinned: b(r.pinned),
    parent_id: (r.parent_id as string | null) ?? null,
    rrule: (r.rrule as string | null) ?? null,
    sort_order: r.sort_order as number,
    score: (r.score as number | null) ?? null,
    source: r.source as Task['source'],
    estimate_is_ai: b(r.estimate_is_ai),
    is_locked: b(r.is_locked),
    enc_blob: null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    completed_at: (r.completed_at as string | null) ?? null,
    deleted_at: (r.deleted_at as string | null) ?? null,
    rev: r.rev as number,
  };
}

function rowToBlock(r: Row): Block {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    task_id: (r.task_id as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    start_at: r.start_at as string,
    end_at: r.end_at as string,
    is_all_day: b(r.is_all_day),
    source: r.source as Block['source'],
    deleted_at: (r.deleted_at as string | null) ?? null,
    rev: r.rev as number,
  };
}

function rowToTag(r: Row): Tag {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    name: r.name as string,
    color: r.color as string,
    sort_order: r.sort_order as number,
    deleted_at: (r.deleted_at as string | null) ?? null,
    rev: r.rev as number,
  };
}

async function outbox(db: SQLiteDatabase, table: string, rowId: string, op: 'upsert' | 'delete', payload: unknown) {
  await db.runAsync(
    'INSERT INTO outbox (table_name,row_id,op,payload,created_at) VALUES (?,?,?,?,?)',
    table, rowId, op, JSON.stringify(payload), nowIso(),
  );
}

const arr = <T>(v: T | T[] | undefined): T[] | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v : [v];

class SqliteTaskRepo implements TaskRepo {
  async list(f: TaskFilter = {}): Promise<Task[]> {
    const db = await getDb();
    const where: string[] = ['user_id = ?'];
    const args: unknown[] = [USER_ID];
    if (!f.includeDeleted) where.push('deleted_at IS NULL');
    const kinds = arr(f.kind);
    if (kinds?.length) {
      where.push(`kind IN (${kinds.map(() => '?').join(',')})`);
      args.push(...kinds);
    }
    const statuses = arr(f.status);
    if (statuses?.length) {
      where.push(`status IN (${statuses.map(() => '?').join(',')})`);
      args.push(...statuses);
    }
    if (f.dayOf) {
      where.push('day_of = ?');
      args.push(f.dayOf);
    }
    if (f.dueFrom) {
      where.push('due_at >= ?');
      args.push(f.dueFrom);
    }
    if (f.dueTo) {
      where.push('due_at <= ?');
      args.push(f.dueTo);
    }
    if (f.search) {
      where.push('(title LIKE ? OR notes LIKE ?)');
      args.push(`%${f.search}%`, `%${f.search}%`);
    }
    if (f.tagIds?.length) {
      where.push(`id IN (SELECT task_id FROM task_tags WHERE tag_id IN (${f.tagIds.map(() => '?').join(',')}))`);
      args.push(...f.tagIds);
    }
    const rows = await db.getAllAsync<Row>(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY sort_order`, ...(args as never[]));
    return rows.map(rowToTask);
  }

  async get(id: string) {
    const db = await getDb();
    const r = await db.getFirstAsync<Row>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', id, USER_ID);
    return r ? rowToTask(r) : null;
  }

  async upsert(t: Task): Promise<Task> {
    const db = await getDb();
    const next: Task = { ...t, user_id: USER_ID, updated_at: nowIso(), rev: t.rev + 1 };
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT OR REPLACE INTO tasks (id,user_id,title,notes,kind,status,day_of,start_at,due_at,estimate_min,spent_min,
          importance,progress,pinned,parent_id,rrule,sort_order,score,source,estimate_is_ai,is_locked,enc_blob,
          created_at,updated_at,completed_at,deleted_at,rev)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        next.id, next.user_id, next.title, next.notes, next.kind, next.status, next.day_of, next.start_at, next.due_at,
        next.estimate_min, next.spent_min, next.importance, next.progress, next.pinned ? 1 : 0, next.parent_id, next.rrule,
        next.sort_order, next.score, next.source, next.estimate_is_ai ? 1 : 0, next.is_locked ? 1 : 0, null,
        next.created_at, next.updated_at, next.completed_at, next.deleted_at, next.rev,
      );
      await outbox(db, 'tasks', next.id, 'upsert', next);
    });
    return next;
  }

  async upsertMany(tasks: Task[]) {
    for (const t of tasks) await this.upsert(t);
  }

  async remove(id: string) {
    const t = await this.get(id);
    if (!t) return;
    await this.upsert({ ...t, deleted_at: nowIso() }); // 툼스톤
  }

  async syncSince(rev: number) {
    const db = await getDb();
    const rows = await db.getAllAsync<Row>('SELECT * FROM tasks WHERE user_id = ? AND rev > ?', USER_ID, rev);
    const tasks = rows.map(rowToTask);
    return { tasks, rev: tasks.reduce((m, t) => Math.max(m, t.rev), rev) };
  }
}

class SqliteBlockRepo implements BlockRepo {
  async list(range: BlockRange) {
    const db = await getDb();
    const rows = await db.getAllAsync<Row>(
      'SELECT * FROM blocks WHERE user_id = ? AND deleted_at IS NULL AND end_at > ? AND start_at < ?',
      USER_ID, range.from, range.to,
    );
    return rows.map(rowToBlock);
  }
  async listByTask(taskId: string) {
    const db = await getDb();
    const rows = await db.getAllAsync<Row>('SELECT * FROM blocks WHERE task_id = ? AND deleted_at IS NULL', taskId);
    return rows.map(rowToBlock);
  }
  async upsert(blk: Block) {
    const db = await getDb();
    const next: Block = { ...blk, user_id: USER_ID, rev: blk.rev + 1 };
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'INSERT OR REPLACE INTO blocks (id,user_id,task_id,title,start_at,end_at,is_all_day,source,deleted_at,rev) VALUES (?,?,?,?,?,?,?,?,?,?)',
        next.id, next.user_id, next.task_id, next.title, next.start_at, next.end_at, next.is_all_day ? 1 : 0, next.source, next.deleted_at, next.rev,
      );
      await outbox(db, 'blocks', next.id, 'upsert', next);
    });
    return next;
  }
  async remove(id: string) {
    const db = await getDb();
    const r = await db.getFirstAsync<Row>('SELECT * FROM blocks WHERE id = ?', id);
    if (!r) return;
    await this.upsert({ ...rowToBlock(r), deleted_at: nowIso() });
  }
}

class SqliteTagRepo implements TagRepo {
  async list() {
    const db = await getDb();
    const rows = await db.getAllAsync<Row>('SELECT * FROM tags WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order', USER_ID);
    return rows.map(rowToTag);
  }
  async upsert(tag: Tag) {
    const db = await getDb();
    const next: Tag = { ...tag, user_id: USER_ID, rev: tag.rev + 1 };
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'INSERT OR REPLACE INTO tags (id,user_id,name,color,sort_order,deleted_at,rev) VALUES (?,?,?,?,?,?,?)',
        next.id, next.user_id, next.name, next.color, next.sort_order, next.deleted_at, next.rev,
      );
      await outbox(db, 'tags', next.id, 'upsert', next);
    });
    return next;
  }
  async remove(id: string) {
    const db = await getDb();
    const r = await db.getFirstAsync<Row>('SELECT * FROM tags WHERE id = ?', id);
    if (!r) return;
    await this.upsert({ ...rowToTag(r), deleted_at: nowIso() });
  }
  async setTaskTags(taskId: string, tagIds: string[]) {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM task_tags WHERE task_id = ?', taskId);
      for (const tagId of tagIds) await db.runAsync('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)', taskId, tagId);
      await outbox(db, 'task_tags', taskId, 'upsert', { task_id: taskId, tag_ids: tagIds });
    });
  }
  async tagsOf(taskId: string) {
    const db = await getDb();
    const rows = await db.getAllAsync<Row>(
      'SELECT t.* FROM tags t JOIN task_tags tt ON tt.tag_id = t.id WHERE tt.task_id = ? AND t.deleted_at IS NULL',
      taskId,
    );
    return rows.map(rowToTag);
  }
  /** 모든 연결을 한 번에 — 화면이 태스크마다 쿼리를 날리지 않게 */
  async allLinks(): Promise<Record<string, string[]>> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ task_id: string; tag_id: string }>('SELECT task_id, tag_id FROM task_tags');
    const m: Record<string, string[]> = {};
    for (const r of rows) (m[r.task_id] ??= []).push(r.tag_id);
    return m;
  }
}

export const repos: Repos & { tags: SqliteTagRepo } = {
  tasks: new SqliteTaskRepo(),
  blocks: new SqliteBlockRepo(),
  tags: new SqliteTagRepo(),
};

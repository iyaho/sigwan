import { makeMockData } from '@sigwan/core';
import * as SQLite from 'expo-sqlite';

/**
 * 로컬 SQLite — 명세 5장 스키마 그대로 + outbox.
 *
 * 7장 동기화 계약을 서버 없이도 지킨다:
 *  - id는 클라이언트 UUIDv7 (core/newId)
 *  - rev 단조 증가, deleted_at 툼스톤
 *  - 모든 쓰기는 outbox에 한 줄 남긴다 → M2에서 온라인 시 순서대로 flush
 *  - user_id는 레포지토리가 주입한다. 화면 코드는 모른다
 *
 * 지금은 SQL 문자열이다. Drizzle(11.3)은 스키마가 굳은 뒤 마이그레이션 생성기와 함께 얹는다 —
 * 지금 넣으면 babel inline-import·drizzle-kit 설정이 첫 실행을 막는다.
 */

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * 쓰기 직렬 큐.
 *
 * expo-sqlite는 연결 하나를 공유한다. 트랜잭션이 겹치면
 *   withTransactionAsync          → "cannot rollback - no transaction is active"
 *   withExclusiveTransactionAsync → "database is locked"
 * 둘 다 같은 병 — 동시 접근이다. 트랜잭션 종류를 바꾸는 대신 쓰기를 한 줄로 세운다.
 * 읽기는 WAL이라 서로 막지 않으므로 큐에 넣지 않는다.
 */
let chain: Promise<unknown> = Promise.resolve();

export function serial<T>(fn: () => Promise<T>): Promise<T> {
  // 앞 작업이 실패해도 줄은 계속 간다
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** 모든 쓰기는 이걸로. 큐에 서고, 그 안에서만 트랜잭션을 연다. */
export async function withWrite<T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const db = await getDb();
  return serial(async () => {
    let out!: T;
    await db.withTransactionAsync(async () => {
      out = await fn(db);
    });
    return out;
  });
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

async function open() {
  const db = await SQLite.openDatabaseAsync('sigwan.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('day','deadline','someday')),
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
      day_of TEXT,
      start_at TEXT,
      due_at TEXT,
      estimate_min INTEGER NOT NULL DEFAULT 60,
      spent_min INTEGER NOT NULL DEFAULT 0,
      importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
      progress REAL NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      rrule TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      score REAL,
      source TEXT NOT NULL DEFAULT 'manual',
      estimate_is_ai INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      enc_blob BLOB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      deleted_at TEXT,
      rev INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks (user_id, status) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_rev ON tasks (user_id, rev);

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_id TEXT,
      title TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL CHECK (end_at > start_at),
      is_all_day INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      deleted_at TEXT,
      rev INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_range ON blocks (user_id, start_at, end_at) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order REAL NOT NULL DEFAULT 0,
      deleted_at TEXT,
      rev INTEGER NOT NULL DEFAULT 0,
      UNIQUE (user_id, name)
    );
    CREATE TABLE IF NOT EXISTS task_tags (
      task_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (task_id, tag_id)
    );

    -- 명세 3.8 / 5.1 — 고정 일정·설정·체크
    -- 기존 설치에도 IF NOT EXISTS로 그냥 생긴다. 마이그레이션이 따로 필요 없다.
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      weekdays TEXT NOT NULL,                    -- '0,2' — 0=월 … 6=일
      start_min INTEGER NOT NULL,
      end_min INTEGER NOT NULL CHECK (end_min > start_min),  -- 자정 넘김 미지원 (3.8.1)
      color TEXT NOT NULL,
      active_from TEXT,
      active_to TEXT,
      deleted_at TEXT,
      rev INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_routines_live ON routines (user_id) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY,
      sleep TEXT NOT NULL,                       -- JSON {weekdayStart,weekdayEnd,weekendStart,weekendEnd}
      weight_urgent REAL NOT NULL DEFAULT 0.6,
      half_life_hours REAL NOT NULL DEFAULT 48,
      gap_min INTEGER NOT NULL DEFAULT 10,
      updated_at TEXT NOT NULL,
      rev INTEGER NOT NULL DEFAULT 0
    );

    -- id가 routine_id + ':' + day 로 계산된 값이다 (명세 5.1). 7장 UUIDv7 원칙의 유일한 예외 —
    -- 이 행은 '새로 만드는 것'이 아니라 (일정, 날짜) 한 쌍에 대한 사실이라, 웹과 앱이
    -- 각각 체크해도 같은 행을 두 번 쓰게 되어 병합이 필요 없다.
    CREATE TABLE IF NOT EXISTS routine_checks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      routine_id TEXT NOT NULL,
      day TEXT NOT NULL,                         -- 로컬 날짜 YYYY-MM-DD (7장)
      checked_at TEXT NOT NULL,
      deleted_at TEXT,
      rev INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_routine_checks_day ON routine_checks (user_id, day) WHERE deleted_at IS NULL;

    -- 7장 아웃박스: 로컬 쓰기 로그. M2에서 온라인이 되면 seq 순으로 서버에 flush
    CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  await seedIfEmpty(db);
  return db;
}

/** 첫 실행에 목 데이터 (16.8-4). 트랜잭션 안에서 count를 봐서 두 번 들어가지 않는다 */
async function seedIfEmpty(db: SQLite.SQLiteDatabase) {
  /**
   * 할 일만 보면 안 된다. 할 일이 지워지고 태그만 남은 상태에서 다시 심으면
   * 같은 이름의 태그를 또 넣게 되고 UNIQUE(user_id, name)에 걸린다.
   * 게다가 아래 INSERT가 맨 INSERT였어서 그대로 예외가 됐다 — 지금은 OR REPLACE다.
   */
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM tags) AS n',
  );
  if ((row?.n ?? 0) > 0) return;
  const m = makeMockData(new Date());
  // open() 안에서 불리므로 withWrite(→getDb)를 쓰면 자기 자신을 기다려 교착된다
  await serial(() =>
    db.withTransactionAsync(async () => {
    for (const t of m.tags) {
      await db.runAsync(
        'INSERT OR REPLACE INTO tags (id,user_id,name,color,sort_order,deleted_at,rev) VALUES (?,?,?,?,?,?,?)',
        t.id, t.user_id, t.name, t.color, t.sort_order, t.deleted_at, t.rev,
      );
    }
    for (const t of m.tasks) {
      await db.runAsync(
        `INSERT OR REPLACE INTO tasks (id,user_id,title,notes,kind,status,day_of,start_at,due_at,estimate_min,spent_min,
          importance,progress,pinned,parent_id,rrule,sort_order,score,source,estimate_is_ai,is_locked,enc_blob,
          created_at,updated_at,completed_at,deleted_at,rev)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.id, t.user_id, t.title, t.notes, t.kind, t.status, t.day_of, t.start_at, t.due_at, t.estimate_min,
        t.spent_min, t.importance, t.progress, t.pinned ? 1 : 0, t.parent_id, t.rrule, t.sort_order, t.score,
        t.source, t.estimate_is_ai ? 1 : 0, t.is_locked ? 1 : 0, null, t.created_at, t.updated_at,
        t.completed_at, t.deleted_at, t.rev,
      );
    }
    for (const b of m.blocks) {
      await db.runAsync(
        'INSERT OR REPLACE INTO blocks (id,user_id,task_id,title,start_at,end_at,is_all_day,source,deleted_at,rev) VALUES (?,?,?,?,?,?,?,?,?,?)',
        b.id, b.user_id, b.task_id, b.title, b.start_at, b.end_at, b.is_all_day ? 1 : 0, b.source, b.deleted_at, b.rev,
      );
    }
    for (const tt of m.taskTags) {
      await db.runAsync('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)', tt.task_id, tt.tag_id);
    }
      await db.runAsync("INSERT OR REPLACE INTO meta (key,value) VALUES ('seeded_at', ?)", new Date().toISOString());
    }),
  );
}

/** 개발용 — 전부 지우고 다시 심는다 */
export async function resetAll() {
  const db = await getDb();
  await serial(() =>
    db.execAsync(
      'DELETE FROM task_tags; DELETE FROM blocks; DELETE FROM tasks; DELETE FROM tags;' +
        ' DELETE FROM routine_checks; DELETE FROM routines; DELETE FROM settings;' +
        ' DELETE FROM outbox; DELETE FROM meta;',
    ),
  );
  await seedIfEmpty(db);
}

/** 앱 설정 몇 개 — 온보딩 봤는지 같은 것. 동기화 대상이 아니라 meta에 둔다 */
export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return r?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await serial(() => db.runAsync('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)', key, value));
}

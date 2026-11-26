import 'fake-indexeddb/auto';
import type { PullChange, PushChange, SyncServer, SyncTable, Task } from '@sigwan/core';
import { createSupabaseServer, newId, nowIso, syncOnce } from '@sigwan/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDemo, db, enqueueAll, repos, seedIfEmpty, wipeLocal } from './db';
import { dexieSyncLocal } from './sync';

/**
 * 웹(Dexie) 동기화 — core/syncOnce + dexieSyncLocal.
 * 평소엔 메모리 서버로 돈다. SIGWAN_SUPABASE_URL · SIGWAN_SUPABASE_KEY를 주면 실서버로도 돈다
 * (그때마다 테스트 계정이 하나 생긴다 — 대시보드에서 지울 것).
 */

const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: newId(),
  user_id: 'local-user',
  title,
  notes: null,
  kind: 'deadline',
  status: 'todo',
  day_of: null,
  start_at: null,
  due_at: '2026-12-01T09:00:00.000Z',
  estimate_min: 60,
  spent_min: 0,
  importance: 3,
  progress: 0,
  pinned: false,
  parent_id: null,
  rrule: null,
  sort_order: 1,
  score: null,
  source: 'manual',
  estimate_is_ai: false,
  is_locked: false,
  enc_blob: null,
  created_at: nowIso(),
  updated_at: nowIso(),
  completed_at: null,
  deleted_at: null,
  rev: 0,
  ...extra,
});

/** 메모리 서버 — 받은 행을 그대로 쌓고 번호를 매긴다. 충돌 규칙은 SQL 시험이 본다 */
function memoryServer() {
  let rev = 0;
  const rows = new Map<string, { table: SyncTable; row: Record<string, unknown>; rev: number }>();
  const key = (t: SyncTable, r: Record<string, unknown>) =>
    `${t}:${t === 'settings' ? 'me' : t === 'task_tags' ? r.task_id : r.id}`;
  const server: SyncServer = {
    async push(changes: PushChange[]) {
      for (const c of changes) {
        const row = { ...(c.row as Record<string, unknown>), user_id: 'uuid' };
        rows.set(key(c.table, row), { table: c.table, row, rev: ++rev });
      }
      return { applied: changes.map((c) => c.seq), rejected: [], rev };
    },
    async pull(since: number) {
      const changes: PullChange[] = [...rows.values()]
        .filter((r) => r.rev > since)
        .sort((a, b) => a.rev - b.rev)
        .map((r) => ({ table: r.table, row: { ...r.row, server_rev: r.rev } }));
      return { changes, rev: rev, more: false };
    },
  };
  return { server, put: (table: SyncTable, row: Record<string, unknown>) => rows.set(key(table, row), { table, row, rev: ++rev }) };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('dexieSyncLocal', () => {
  it('레포로 쓴 것이 outbox에 base_rev와 함께 남고, 동기화하면 비워진다', async () => {
    const m = memoryServer();
    const t = await repos.tasks.upsert(task('과제'));
    await repos.tags.setTaskTags(t.id, ['g1']);
    const ob = await db.outbox.toArray();
    expect(ob.map((e) => [e.table_name, e.base_rev])).toEqual([
      ['tasks', 0],
      ['task_tags', 0],
    ]);

    const r = await syncOnce(dexieSyncLocal, m.server);
    expect(r).toMatchObject({ pushed: 2, rejected: 0, pulled: 2, rev: 2 });
    expect(await db.outbox.count()).toBe(0);
    expect(await dexieSyncLocal.getCursor()).toBe(2);

    // 다음 쓰기는 지금 커서를 base로 단다
    await repos.tasks.upsert({ ...t, title: '고친 과제' });
    expect((await db.outbox.toArray())[0]!.base_rev).toBe(2);
  });

  it('다른 기기가 올린 것을 받아 화면이 읽는 그 테이블에 넣는다 — outbox에는 안 남는다', async () => {
    const m = memoryServer();
    m.put('tasks', { ...task('폰에서 만든 것'), id: 'from-phone', updated_at: '2026-11-25T01:00:00+00:00' });
    m.put('task_tags', { task_id: 'from-phone', tag_ids: ['g1', 'g2'], updated_at: '2026-11-25T01:00:00+00:00' });
    m.put('routines', {
      id: 'r1', timetable_id: 'tt', name: '자료구조', weekdays: [0, 2], start_min: 630, end_min: 720,
      color: '#3e63dd', deleted_at: null, updated_at: '2026-11-25T01:00:00+00:00',
    });
    await syncOnce(dexieSyncLocal, m.server);

    const got = await repos.tasks.get('from-phone');
    expect(got).toMatchObject({ title: '폰에서 만든 것', user_id: 'local-user', updated_at: '2026-11-25T01:00:00.000Z' });
    expect((await repos.tags.tagsOf('from-phone')).length).toBe(0); // 태그 행 자체는 아직 없다
    expect((await db.task_tags.where('task_id').equals('from-phone').toArray()).map((l) => l.tag_id)).toEqual(['g1', 'g2']);
    expect((await repos.routines.list())[0]).toMatchObject({ name: '자료구조', weekdays: [0, 2] });
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('예시 데이터와 로그인', () => {
  beforeEach(async () => {
    await wipeLocal();
  });

  it('예시는 보여 주기만 — 고친 기록도 서버로 안 가고, 처음 등록하면 사라진다', async () => {
    await seedIfEmpty();
    const demo = await repos.tasks.list();
    expect(demo.length).toBeGreaterThan(20);
    await repos.tasks.upsert({ ...demo[0]!, status: 'done' }); // 예시를 체크해 본다
    expect(await db.outbox.count()).toBe(1);

    const del = await clearDemo();
    expect(del!.tasks.length).toBe(demo.length);
    expect(await db.tasks.count()).toBe(0);
    expect(await db.blocks.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await clearDemo()).toBeNull(); // 두 번째는 할 일이 없다

    await seedIfEmpty(); // 다시 열어도 예시를 또 넣지 않는다
    expect(await db.tasks.count()).toBe(0);
  });

  it('처음 로그인 — 예시는 빼고, 내가 쓴 것은 outbox에 없던 것까지 전부 적는다', async () => {
    await seedIfEmpty();
    const mine = await repos.tasks.upsert(task('내 할 일'));
    await repos.tags.setTaskTags(mine.id, ['g1']);
    await db.outbox.clear(); // outbox가 비어 있어도(예: 기록 전에 쓴 것) 다 올라가야 한다

    const n = await enqueueAll();
    const ob = await db.outbox.toArray();
    expect(n).toBe(2);
    expect(ob.map((e) => [e.table_name, e.row_id])).toEqual([
      ['tasks', mine.id],
      ['task_tags', mine.id],
    ]);
  });
});

const URL = process.env.SIGWAN_SUPABASE_URL;
const KEY = process.env.SIGWAN_SUPABASE_KEY;

describe.skipIf(!URL || !KEY)('실서버 (Supabase)', () => {
  async function signUp() {
    const name = `e2e-${Math.random().toString(36).slice(2, 8)}`;
    const res = await fetch(`${URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${name}@users.sigwan.invalid`, password: `${newId()}Aa1`, data: { username: name } }),
    });
    const d = (await res.json()) as { access_token?: string };
    if (!d.access_token) throw new Error(`signup: ${JSON.stringify(d)}`);
    console.log(`테스트 계정 ${name} — 대시보드에서 지울 것`);
    return d.access_token;
  }
  const rpcWith = (token: string) => async (fn: string, args: Record<string, unknown>) => {
    const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY!, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    return res.ok ? { data, error: null } : { data: null, error: { message: JSON.stringify(data) } };
  };

  it('이 기기의 모든 종류를 올리고, 다른 기기의 변경을 받고, 최신을 보고 푼 체크는 풀린다', async () => {
    const token = await signUp();
    const rpc = rpcWith(token);
    const server = createSupabaseServer(rpc);

    // 기기 1 — 종류마다 하나씩 쓴다
    const t = await repos.tasks.upsert(task('실서버 과제'));
    await repos.blocks.upsert({
      id: newId(), user_id: 'local-user', task_id: t.id, title: null, start_at: '2026-11-26T01:00:00.000Z',
      end_at: '2026-11-26T02:00:00.000Z', is_all_day: false, source: 'drag', deleted_at: null, updated_at: nowIso(), rev: 0,
    });
    const tag = await repos.tags.upsert({ id: newId(), user_id: 'local-user', name: '학교', color: '#3e63dd', sort_order: 0, deleted_at: null, updated_at: nowIso(), rev: 0 });
    await repos.tags.setTaskTags(t.id, [tag.id]);
    const tt = await repos.timetables.upsert({ id: 'tt-legacy', user_id: 'local-user', name: '기본', active_from: null, active_to: null, deleted_at: null, updated_at: nowIso(), rev: 0 });
    const r1 = await repos.routines.upsert({ id: newId(), user_id: 'local-user', timetable_id: tt.id, name: '운영체제', weekdays: [1, 3], start_min: 780, end_min: 870, color: '#3e63dd', deleted_at: null, updated_at: nowIso(), rev: 0 });
    await repos.routineChecks.toggle(r1.id, '2026-11-25');
    await repos.settings.save({ user_id: 'local-user', sleep: { weekdayStart: 60, weekdayEnd: 480, weekendStart: 120, weekendEnd: 600 }, weight_urgent: 0.6, half_life_hours: 48, gap_min: 10, updated_at: nowIso(), rev: 0 });

    const first = await syncOnce(dexieSyncLocal, server);
    expect(first).toMatchObject({ pushed: 8, rejected: 0, pulled: 8 });

    // 기기 2 — 최신(rev)을 보고 완료 처리했다고 친다
    const rev = first.rev;
    const pushed = await rpc('sync_push', {
      changes: [{ seq: 1, table: 'tasks', base_rev: rev, row: { ...(await repos.tasks.get(t.id))!, status: 'done', completed_at: nowIso(), updated_at: nowIso() } }],
    });
    expect(pushed.error).toBeNull();

    // 기기 1이 받는다
    const second = await syncOnce(dexieSyncLocal, server);
    expect(second.pulled).toBe(1);
    expect((await repos.tasks.get(t.id))!.status).toBe('done');

    // 기기 1이 그걸 보고 체크를 푼다 → 서버에서도 풀린다 (base_rev가 최신이니 done 우선 규칙이 끼지 않는다)
    await repos.tasks.upsert({ ...(await repos.tasks.get(t.id))!, status: 'todo', completed_at: null });
    await syncOnce(dexieSyncLocal, server);
    const all = (await rpc('sync_pull', { since: 0 })).data as { changes: { table: string; row: { id?: string; status?: string } }[] };
    expect(all.changes.find((c) => c.table === 'tasks' && c.row.id === t.id)!.row.status).toBe('todo');
  }, 30_000);
});

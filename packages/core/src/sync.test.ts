import { describe, expect, it } from 'vitest';
import {
  normalizeRemoteRow,
  type OutboxEntry,
  type PullChange,
  type PushChange,
  pendingKey,
  type SyncLocal,
  type SyncServer,
  type SyncTable,
  syncOnce,
} from './sync';

/** 서버 흉내 — 행마다 server_rev, 사용자 카운터 하나. 충돌 규칙은 SQL 시험이 따로 본다 */
function fakeServer(opts: { reject?: (c: PushChange) => string | null; pageSize?: number } = {}) {
  let rev = 0;
  const rows = new Map<string, { table: SyncTable; row: Record<string, unknown>; rev: number }>();
  const pushes: PushChange[][] = [];
  const keyOf = (t: SyncTable, r: Record<string, unknown>) =>
    `${t}:${t === 'settings' ? 'me' : t === 'task_tags' ? r.task_id : r.id}`;
  const server: SyncServer = {
    async push(changes) {
      pushes.push(changes);
      const applied: number[] = [];
      const rejected: { seq: number; error: string }[] = [];
      for (const c of changes) {
        const err = opts.reject?.(c) ?? null;
        if (err) {
          rejected.push({ seq: c.seq, error: err });
          continue;
        }
        const row: Record<string, unknown> = { ...(c.row as Record<string, unknown>), user_id: 'uuid-a' };
        delete row.rev;
        rows.set(keyOf(c.table, row), { table: c.table, row, rev: ++rev });
        applied.push(c.seq);
      }
      return { applied, rejected, rev };
    },
    async pull(since) {
      const size = opts.pageSize ?? 1000;
      const all = [...rows.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
      const page = all.slice(0, size);
      return {
        changes: page.map((r) => ({ table: r.table, row: { ...r.row, server_rev: r.rev } })),
        rev: page.length ? page[page.length - 1]!.rev : since,
        more: page.length === size,
      };
    },
  };
  return {
    server,
    pushes,
    rows,
    /** 다른 기기가 올린 것처럼 서버에 바로 넣는다 */
    put(table: SyncTable, row: Record<string, unknown>) {
      rows.set(keyOf(table, row), { table, row: { ...row, user_id: 'uuid-a' }, rev: ++rev });
    },
  };
}

/** 기기 흉내 — outbox와 커서, 받은 행 */
function fakeLocal() {
  let seq = 0;
  const outbox: OutboxEntry[] = [];
  const applied: PullChange[] = [];
  const rejected: OutboxEntry[] = [];
  let cursor = 0;
  const local: SyncLocal = {
    async readOutbox(limit) {
      return outbox.slice(0, limit);
    },
    async deleteOutbox(seqs) {
      const s = new Set(seqs);
      for (let i = outbox.length - 1; i >= 0; i--) if (s.has(outbox[i]!.seq)) outbox.splice(i, 1);
    },
    async pendingKeys() {
      return new Set(outbox.map((e) => pendingKey(e.table_name, e.row_id)));
    },
    async getCursor() {
      return cursor;
    },
    async applyRemote(changes, rev) {
      applied.push(...changes);
      cursor = rev;
    },
    async onRejected(entries) {
      rejected.push(...entries);
    },
  };
  return {
    local,
    outbox,
    applied,
    rejected,
    get cursor() {
      return cursor;
    },
    write(table: SyncTable, row: Record<string, unknown>) {
      const id = String(table === 'task_tags' ? row.task_id : row.id);
      outbox.push({
        seq: ++seq,
        table_name: table,
        row_id: id,
        op: 'upsert',
        payload: JSON.stringify(row),
        created_at: '2026-11-25T00:00:00.000Z',
        base_rev: cursor,
      });
    },
  };
}

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: 'local-user',
  title: id,
  updated_at: '2026-11-25T01:00:00.000Z',
  rev: 4,
  ...extra,
});

describe('syncOnce', () => {
  it('outbox를 올리고 비운다 — base_rev(기록할 때의 커서)를 같이 보낸다', async () => {
    const s = fakeServer();
    const l = fakeLocal();
    l.write('tasks', task('t1'));
    l.write('tasks', task('t2'));
    const r = await syncOnce(l.local, s.server);
    expect(r.pushed).toBe(2);
    expect(l.outbox).toHaveLength(0);
    expect(s.pushes[0]!.map((c) => [c.seq, c.base_rev])).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  it('올린 뒤 받는다 — 내가 올린 것도 서버가 정리한 모양으로 다시 내려온다', async () => {
    const s = fakeServer();
    const l = fakeLocal();
    l.write('tasks', task('t1'));
    const r = await syncOnce(l.local, s.server);
    expect(r.pulled).toBe(1);
    expect(l.cursor).toBe(1);
    expect(l.applied[0]!.row).toMatchObject({ id: 't1', user_id: 'local-user', rev: 0 });
    expect(l.applied[0]!.row).not.toHaveProperty('server_rev');
  });

  it('다른 기기가 올린 것을 받고, 커서 이후 것만 받는다', async () => {
    const s = fakeServer();
    const l = fakeLocal();
    s.put('tasks', task('from-phone'));
    await syncOnce(l.local, s.server);
    expect(l.applied.map((c) => c.row.id)).toEqual(['from-phone']);
    s.put('blocks', { id: 'b1', updated_at: '2026-11-25T02:00:00+00:00' });
    await syncOnce(l.local, s.server);
    expect(l.applied.map((c) => c.row.id)).toEqual(['from-phone', 'b1']);
    expect(l.cursor).toBe(2);
  });

  it('여러 쪽으로 나눠 받는다 (more)', async () => {
    const s = fakeServer({ pageSize: 2 });
    const l = fakeLocal();
    for (const id of ['a', 'b', 'c', 'd', 'e']) s.put('tasks', task(id));
    const r = await syncOnce(l.local, s.server);
    expect(r.pulled).toBe(5);
    expect(l.cursor).toBe(5);
  });

  it('거절된 줄은 기록을 남기고 outbox에서 뺀다 — 한 줄 때문에 막히지 않는다', async () => {
    const s = fakeServer({ reject: (c) => ((c.row as { id: string }).id === 'bad' ? 'check constraint' : null) });
    const l = fakeLocal();
    l.write('tasks', task('bad'));
    l.write('tasks', task('ok'));
    const r = await syncOnce(l.local, s.server);
    expect(r).toMatchObject({ pushed: 1, rejected: 1 });
    expect(l.outbox).toHaveLength(0);
    expect(l.rejected.map((e) => e.row_id)).toEqual(['bad']);
  });

  it('아직 안 올린 로컬 변경이 있는 행은 받은 것으로 덮지 않는다', async () => {
    const s = fakeServer();
    const l = fakeLocal();
    s.put('tasks', task('t1', { title: '서버 것' }));
    // 올리기는 끝났는데 받기 직전에 화면에서 또 고친 상황 — pendingKeys에 남아 있다
    const realPull = s.server.pull;
    s.server.pull = async (since) => {
      l.write('tasks', task('t1', { title: '방금 고친 것' }));
      return realPull(since);
    };
    const r = await syncOnce(l.local, s.server);
    expect(r.skipped).toBe(1);
    expect(l.applied).toHaveLength(0);
    expect(l.cursor).toBe(1);
  });

  it('500줄씩 나눠 올린다', async () => {
    const s = fakeServer();
    const l = fakeLocal();
    for (let i = 0; i < 1201; i++) l.write('tasks', task(`t${i}`));
    const r = await syncOnce(l.local, s.server);
    expect(s.pushes.map((p) => p.length)).toEqual([500, 500, 201]);
    expect(r.pushed).toBe(1201);
  });

  it('서버가 아무것도 처리하지 않으면 무한히 다시 보내지 않고 멈춘다', async () => {
    const l = fakeLocal();
    l.write('tasks', task('t1'));
    const server: SyncServer = {
      push: async () => ({ applied: [], rejected: [], rev: 0 }),
      pull: async () => ({ changes: [], rev: 0, more: false }),
    };
    await expect(syncOnce(l.local, server)).rejects.toThrow('아무 변경도');
  });
});

describe('normalizeRemoteRow', () => {
  it("시각을 '…Z'로 — 로컬은 기간 조회를 문자열 비교로 한다", () => {
    const r = normalizeRemoteRow('blocks', {
      id: 'b1',
      user_id: 'uuid-a',
      start_at: '2026-11-25T09:00:00+09:00',
      end_at: '2026-11-25T01:30:00+00:00',
      deleted_at: null,
      updated_at: '2026-11-25T01:00:00.123456+00:00',
      server_rev: 9,
    });
    expect(r).toEqual({
      id: 'b1',
      user_id: 'local-user',
      start_at: '2026-11-25T00:00:00.000Z',
      end_at: '2026-11-25T01:30:00.000Z',
      deleted_at: null,
      updated_at: '2026-11-25T01:00:00.123Z',
      rev: 0,
    });
  });

  it('날짜만 있는 열(day_of 등)은 건드리지 않는다 — 로컬 날짜다', () => {
    const r = normalizeRemoteRow('tasks', { id: 't', day_of: '2026-11-25', updated_at: '2026-11-25T00:00:00Z' });
    expect(r.day_of).toBe('2026-11-25');
  });

  it('task_tags에는 user_id·rev를 붙이지 않는다, settings에는 rev가 없다', () => {
    expect(normalizeRemoteRow('task_tags', { task_id: 't', tag_ids: ['g'], updated_at: '2026-11-25T00:00:00Z', user_id: 'x' }))
      .toEqual({ task_id: 't', tag_ids: ['g'], updated_at: '2026-11-25T00:00:00.000Z', user_id: 'x' });
    expect(normalizeRemoteRow('settings', { user_id: 'uuid', updated_at: '2026-11-25T00:00:00Z' })).toEqual({
      user_id: 'local-user',
      updated_at: '2026-11-25T00:00:00.000Z',
    });
  });
});

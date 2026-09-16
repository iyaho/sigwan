import { describe, expect, it } from 'vitest';
import { blocksOnDay, filterByView, rangeProgress, tasksInRange, tasksOnDay } from './views';
import type { Block, Task } from './types';

const DAY = new Date('2026-09-16T00:00:00+09:00');

function task(over: Partial<Task>): Task {
  return {
    id: over.id ?? 't',
    user_id: 'u1',
    title: 'x',
    notes: null,
    kind: 'deadline',
    status: 'todo',
    day_of: null,
    start_at: null,
    due_at: null,
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
    created_at: DAY.toISOString(),
    updated_at: DAY.toISOString(),
    completed_at: null,
    deleted_at: null,
    rev: 0,
    ...over,
  } as Task;
}

const block = (id: string, s: string, e: string): Block => ({
  id,
  user_id: 'u1',
  task_id: null,
  title: id,
  start_at: new Date(s).toISOString(),
  end_at: new Date(e).toISOString(),
  is_all_day: false,
  source: 'manual',
  deleted_at: null,
  rev: 0,
});

describe('기간에 걸리는 할 일', () => {
  it('마감이 그 날이면 포함', () => {
    const t = task({ due_at: '2026-09-16T23:59:00+09:00' });
    expect(tasksOnDay([t], DAY)).toHaveLength(1);
  });

  it('day_of로도 잡힌다 — 로컬 날짜 기준', () => {
    const t = task({ kind: 'day', due_at: null, day_of: '2026-09-16' });
    expect(tasksOnDay([t], DAY)).toHaveLength(1);
  });

  it('자정 직후 마감은 그 다음 날이다 (UTC로 새면 여기가 깨진다)', () => {
    const t = task({ due_at: '2026-09-17T00:30:00+09:00' });
    expect(tasksOnDay([t], DAY)).toHaveLength(0);
  });

  it('인박스는 어느 기간에도 안 걸린다', () => {
    const t = task({ kind: 'someday', due_at: null, day_of: null });
    expect(tasksOnDay([t], DAY)).toHaveLength(0);
  });

  it('삭제된 것은 빠진다', () => {
    const t = task({ due_at: '2026-09-16T10:00:00+09:00', deleted_at: DAY.toISOString() });
    expect(tasksOnDay([t], DAY)).toHaveLength(0);
  });

  it('주 단위로도 같은 규칙', () => {
    const inWeek = task({ id: 'a', due_at: '2026-09-18T10:00:00+09:00' });
    const outWeek = task({ id: 'b', due_at: '2026-09-25T10:00:00+09:00' });
    const start = new Date('2026-09-14T00:00:00+09:00');
    const end = new Date('2026-09-21T00:00:00+09:00');
    expect(tasksInRange([inWeek, outWeek], start, end).map((t) => t.id)).toEqual(['a']);
  });
});

describe('진행도는 같은 풀을 쓴다', () => {
  it('완료/전체', () => {
    const a = task({ id: 'a', due_at: '2026-09-16T10:00:00+09:00', status: 'done' });
    const b = task({ id: 'b', due_at: '2026-09-16T12:00:00+09:00' });
    const end = new Date('2026-09-17T00:00:00+09:00');
    expect(rangeProgress([a, b], DAY, end)).toEqual({ done: 1, total: 2 });
  });
});

describe('그 날의 블록', () => {
  it('자정을 넘는 블록은 양쪽 날에 걸린다', () => {
    const b = block('b1', '2026-09-16T23:00:00+09:00', '2026-09-17T01:00:00+09:00');
    expect(blocksOnDay([b], DAY)).toHaveLength(1);
    expect(blocksOnDay([b], new Date('2026-09-17T00:00:00+09:00'))).toHaveLength(1);
  });

  it('시작 시각 순으로 정렬된다', () => {
    const late = block('late', '2026-09-16T15:00:00+09:00', '2026-09-16T16:00:00+09:00');
    const early = block('early', '2026-09-16T09:00:00+09:00', '2026-09-16T10:00:00+09:00');
    expect(blocksOnDay([late, early], DAY).map((b) => b.id)).toEqual(['early', 'late']);
  });
});

describe('오늘 필터는 그대로 동작한다', () => {
  it('완료된 것은 오늘에서 빠진다', () => {
    const now = new Date('2026-09-16T12:00:00+09:00');
    const done = task({ id: 'a', kind: 'day', day_of: '2026-09-16', status: 'done' });
    const open = task({ id: 'b', kind: 'day', day_of: '2026-09-16' });
    expect(filterByView([done, open], 'today', now).map((t) => t.id)).toEqual(['b']);
  });
});

import { describe, expect, it } from 'vitest';
import { parentUpdate, progressOf } from './progress';
import type { Task } from './types';

function task(p: Partial<Task> & { id: string }): Task {
  return {
    user_id: 'u',
    title: p.id,
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
    sort_order: 0,
    score: null,
    source: 'manual',
    estimate_is_ai: false,
    is_locked: false,
    enc_blob: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    completed_at: null,
    deleted_at: null,
    rev: 0,
    ...p,
  };
}

describe('3.6 부모 progress', () => {
  const p = task({ id: 'p' });
  const a = task({ id: 'a', parent_id: 'p', status: 'done' });
  const b = task({ id: 'b', parent_id: 'p' });
  const c = task({ id: 'c', parent_id: 'p' });
  const all = [p, a, b, c];

  it('완료 자식 / 전체 자식', () => {
    expect(progressOf(p, all)).toBeCloseTo(1 / 3, 6);
  });

  it('삭제된 자식은 세지 않는다', () => {
    const cDel = { ...c, deleted_at: '2026-09-02T00:00:00Z' };
    expect(progressOf(p, [p, a, b, cDel])).toBeCloseTo(0.5, 6);
  });

  it('자식이 없으면 자기 status', () => {
    expect(progressOf(task({ id: 'x' }), [])).toBe(0);
    expect(progressOf(task({ id: 'y', status: 'done' }), [])).toBe(1);
  });

  it('parentUpdate는 바뀔 때만 부모를 돌려준다', () => {
    expect(parentUpdate(a, all)?.progress).toBeCloseTo(1 / 3, 6);
    const already = { ...p, progress: 1 / 3 };
    expect(parentUpdate(a, [already, a, b, c])).toBeNull();
    expect(parentUpdate(task({ id: 'orphan' }), all)).toBeNull();
  });
});

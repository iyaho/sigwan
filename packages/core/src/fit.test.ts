import { describe, expect, it } from 'vitest';
import {
  MAX_SESSION_MIN,
  fitBlock,
  fitSummary,
  nextFreeSlot,
  remainingToSchedule,
} from './fit';
import type { Block, Task } from './types';

const at = (s: string) => new Date(`2026-09-16T${s}:00+09:00`);

function block(id: string, start: string, end: string, taskId: string | null = null): Block {
  return {
    id,
    user_id: 'u1',
    task_id: taskId,
    title: id,
    start_at: at(start).toISOString(),
    end_at: at(end).toISOString(),
    is_all_day: false,
    source: 'manual',
    deleted_at: null,
    rev: 0,
  };
}

function task(estimate: number, spent = 0): Task {
  return {
    id: 't1',
    user_id: 'u1',
    title: '포폴 리뉴얼',
    notes: null,
    kind: 'deadline',
    status: 'todo',
    day_of: null,
    start_at: null,
    due_at: '2026-10-15T14:00:00+09:00',
    estimate_min: estimate,
    spent_min: spent,
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
    created_at: at('00:00').toISOString(),
    updated_at: at('00:00').toISOString(),
    completed_at: null,
    deleted_at: null,
    rev: 0,
  } as Task;
}

describe('빈 구간 계산', () => {
  it('막는 게 없으면 원하는 만큼 다 잡힌다', () => {
    const f = fitBlock({ start: at('10:00'), wantMinutes: 60, existing: [] });
    expect(f.minutes).toBe(60);
    expect(f.truncated).toBe(false);
    expect(f.limitedBy).toBe('none');
  });

  it('다음 블록 직전까지 잘린다', () => {
    const f = fitBlock({
      start: at('10:00'),
      wantMinutes: 120,
      existing: [block('b1', '11:00', '12:00')],
    });
    expect(f.minutes).toBe(60);
    expect(f.end.toISOString()).toBe(at('11:00').toISOString());
    expect(f.shortfallMin).toBe(60);
    expect(f.limitedBy).toBe('gap');
  });

  it('딱 붙은 블록 — 경계가 겹치지 않는다', () => {
    const f = fitBlock({
      start: at('10:00'),
      wantMinutes: 60,
      existing: [block('b1', '11:00', '12:00')],
    });
    expect(f.end.getTime()).toBe(Date.parse(block('b1', '11:00', '12:00').start_at));
    expect(f.truncated).toBe(false);
  });

  it('시작 시각이 이미 블록 안이면 tooSmall', () => {
    const f = fitBlock({
      start: at('10:30'),
      wantMinutes: 60,
      existing: [block('b1', '10:00', '11:00')],
    });
    expect(f.minutes).toBe(0);
    expect(f.tooSmall).toBe(true);
  });

  it('뒤에 있는 블록만 본다 — 지나간 블록은 무시', () => {
    const f = fitBlock({
      start: at('13:00'),
      wantMinutes: 60,
      existing: [block('b1', '09:00', '10:00')],
    });
    expect(f.minutes).toBe(60);
  });

  it('삭제된 블록은 막지 않는다', () => {
    const dead = { ...block('b1', '11:00', '12:00'), deleted_at: at('09:00').toISOString() };
    const f = fitBlock({ start: at('10:00'), wantMinutes: 120, existing: [dead] });
    expect(f.minutes).toBe(120);
  });

  it('가장 가까운 블록이 기준이다', () => {
    const f = fitBlock({
      start: at('09:00'),
      wantMinutes: 480,
      existing: [block('b2', '15:00', '16:00'), block('b1', '10:00', '10:30')],
    });
    expect(f.minutes).toBe(60);
  });
});

describe('하루 끝과 1회 상한', () => {
  it('자정을 넘기지 않는다', () => {
    const f = fitBlock({ start: at('23:00'), wantMinutes: 180, existing: [], maxMinutes: null });
    expect(f.minutes).toBe(60);
    expect(f.limitedBy).toBe('day-end');
  });

  it('20시간짜리는 1회 상한까지만 — 이게 잘림의 정체다', () => {
    const f = fitBlock({ start: at('09:00'), wantMinutes: 20 * 60, existing: [] });
    expect(f.minutes).toBe(MAX_SESSION_MIN);
    expect(f.shortfallMin).toBe(20 * 60 - MAX_SESSION_MIN);
    expect(f.limitedBy).toBe('max-session');
  });

  it('상한보다 빈 구간이 더 좁으면 빈 구간이 이긴다', () => {
    const f = fitBlock({
      start: at('09:00'),
      wantMinutes: 20 * 60,
      existing: [block('b1', '10:00', '11:00')],
    });
    expect(f.minutes).toBe(60);
    expect(f.limitedBy).toBe('gap');
  });

  it('상한을 끄면 하루 끝까지 간다', () => {
    const f = fitBlock({
      start: at('09:00'),
      wantMinutes: 20 * 60,
      existing: [],
      maxMinutes: null,
    });
    expect(f.minutes).toBe(15 * 60);
    expect(f.limitedBy).toBe('day-end');
  });
});

describe('최소 길이', () => {
  it('15분 미만이면 만들지 말라고 한다', () => {
    const f = fitBlock({
      start: at('10:00'),
      wantMinutes: 60,
      existing: [block('b1', '10:10', '11:00')],
    });
    expect(f.minutes).toBe(10);
    expect(f.tooSmall).toBe(true);
  });

  it('정확히 15분은 통과', () => {
    const f = fitBlock({
      start: at('10:00'),
      wantMinutes: 60,
      existing: [block('b1', '10:15', '11:00')],
    });
    expect(f.minutes).toBe(15);
    expect(f.tooSmall).toBe(false);
  });
});

describe('남은 작업량', () => {
  it('예상 시간에서 한 시간과 이미 잡은 블록을 뺀다', () => {
    const t = task(20 * 60, 60);
    const blocks = [block('b1', '09:00', '13:00', 't1')];
    expect(remainingToSchedule(t, blocks)).toBe(20 * 60 - 60 - 240);
  });

  it('다른 할 일의 블록은 안 센다', () => {
    const t = task(120);
    expect(remainingToSchedule(t, [block('b1', '09:00', '10:00', 'other')])).toBe(120);
  });

  it('다 잡았으면 0, 음수로 내려가지 않는다', () => {
    const t = task(60);
    expect(remainingToSchedule(t, [block('b1', '09:00', '13:00', 't1')])).toBe(0);
  });
});

describe('다음 빈 슬롯', () => {
  it('막힌 구간 뒤를 알려준다', () => {
    const slot = nextFreeSlot(at('10:00'), 60, [block('b1', '10:00', '11:30')]);
    expect(slot?.toISOString()).toBe(at('11:30').toISOString());
  });

  it('하루 안에 자리가 없으면 null', () => {
    const slot = nextFreeSlot(at('23:00'), 120, []);
    expect(slot).toBeNull();
  });
});

describe('문구', () => {
  it('부족분을 말해준다', () => {
    const f = fitBlock({ start: at('09:00'), wantMinutes: 20 * 60, existing: [] });
    expect(fitSummary(f, 20 * 60)).toBe('20시간 중 4시간 잡힘 · 16시간 남음');
  });

  it('다 잡히면 길이만', () => {
    const f = fitBlock({ start: at('09:00'), wantMinutes: 90, existing: [] });
    expect(fitSummary(f, 90)).toBe('1.5시간 잡힘');
  });
});

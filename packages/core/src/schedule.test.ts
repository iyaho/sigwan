import { describe, expect, it } from 'vitest';
import {
  autoSchedule,
  expandRoutines,
  freeSpans,
  mergeSpans,
  parseHhmm,
  sleepSpans,
} from './schedule';
import type { Block, Routine, SleepPattern, Task } from './types';

const SLEEP: SleepPattern = { weekdayStart: 60, weekdayEnd: 480, weekendStart: 120, weekendEnd: 600 };

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
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    completed_at: null,
    deleted_at: null,
    rev: 0,
    ...p,
  };
}

function block(id: string, s: string, e: string, taskId: string | null = null): Block {
  return {
    id,
    user_id: 'u',
    task_id: taskId,
    title: taskId ? null : id,
    start_at: s,
    end_at: e,
    is_all_day: false,
    source: 'manual',
    deleted_at: null,
    rev: 0,
  };
}

const routine = (p: Partial<Routine> & { id: string; weekdays: number[] }): Routine => ({
  user_id: 'u',
  name: p.id,
  start_min: 9 * 60,
  end_min: 10 * 60 + 30,
  color: '#3e63dd',
  active_from: null,
  active_to: null,
  deleted_at: null,
  rev: 0,
  ...p,
});

// 2026-09-16은 수요일
const WED = new Date('2026-09-16T00:00:00+09:00');
const d = (iso: string) => new Date(iso);

describe('고정 일정 펼치기', () => {
  it('해당 요일에만 생긴다', () => {
    const r = routine({ id: '운영체제', weekdays: [0, 2] }); // 월·수
    const out = expandRoutines([r], WED, new Date(WED.getTime() + 7 * 864e5));
    expect(out).toHaveLength(2); // 수, 다음 월
    expect(new Date(out[0]!.start_at).getHours()).toBe(9);
    expect(new Date(out[0]!.end_at).getMinutes()).toBe(30);
  });

  it('기간 밖은 빠진다', () => {
    const r = routine({ id: '학기', weekdays: [2], active_to: '2026-09-15' });
    expect(expandRoutines([r], WED, new Date(WED.getTime() + 7 * 864e5))).toHaveLength(0);
  });

  it('삭제된 규칙은 무시', () => {
    const r = routine({ id: 'x', weekdays: [2], deleted_at: '2026-09-01T00:00:00+09:00' });
    expect(expandRoutines([r], WED, new Date(WED.getTime() + 864e5))).toHaveLength(0);
  });
});

describe('수면', () => {
  it('자정을 넘긴다 — 평일은 01:00~08:00', () => {
    const out = sleepSpans(SLEEP, WED, new Date(WED.getTime() + 864e5));
    const wed = out.find((b) => new Date(b.end_at).getDate() === 16);
    expect(new Date(wed!.start_at).getHours()).toBe(1);
    expect(new Date(wed!.end_at).getHours()).toBe(8);
  });

  it('기상일이 주말이면 주말 규칙 — 금요일 밤은 주말로 친다', () => {
    const fri = new Date('2026-09-18T00:00:00+09:00');
    const out = sleepSpans(SLEEP, fri, new Date(fri.getTime() + 3 * 864e5));
    const satMorning = out.find((b) => new Date(b.end_at).getDate() === 19); // 토요일 기상
    expect(new Date(satMorning!.start_at).getHours()).toBe(2); // 주말 취침
    expect(new Date(satMorning!.end_at).getHours()).toBe(10); // 주말 기상
  });
});

describe('빈 구간', () => {
  it('겹친 것을 합치고 그 사이를 돌려준다', () => {
    const merged = mergeSpans([
      { start: 0, end: 10 },
      { start: 5, end: 20 },
      { start: 30, end: 40 },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });

  it('블록 사이가 빈 구간이다', () => {
    const free = freeSpans(d('2026-09-16T09:00:00+09:00'), d('2026-09-16T18:00:00+09:00'), [
      block('a', '2026-09-16T10:00:00+09:00', '2026-09-16T11:00:00+09:00'),
      block('b', '2026-09-16T14:00:00+09:00', '2026-09-16T15:00:00+09:00'),
    ]);
    expect(free).toHaveLength(3);
    expect(new Date(free[0]!.end).getHours()).toBe(10);
    expect(new Date(free[1]!.start).getHours()).toBe(11);
  });
});

describe('자동 배치', () => {
  const now = d('2026-09-16T09:00:00+09:00');
  const to = new Date(now.getTime() + 7 * 864e5);

  it('수면과 고정 일정을 피한다', () => {
    const t = task({ id: 'a', estimate_min: 120, due_at: '2026-09-17T23:59:00+09:00' });
    const r = routine({ id: '수업', weekdays: [2], start_min: 9 * 60, end_min: 12 * 60 });
    const { proposals } = autoSchedule({
      tasks: [t],
      blocks: [],
      routines: [r],
      sleep: SLEEP,
      from: now,
      to,
      now,
    });
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      const s = new Date(p.start);
      const e = new Date(p.end);
      // 09:00~12:00 수업 밖
      expect(s.getHours() >= 12 || e.getHours() <= 9).toBe(true);
      // 01:00~08:00 수면 밖
      expect(s.getHours() >= 8).toBe(true);
    }
  });

  it('마감 뒤에는 잡지 않는다', () => {
    const t = task({ id: 'a', estimate_min: 600, due_at: '2026-09-16T14:00:00+09:00' });
    const { proposals, unplaced } = autoSchedule({
      tasks: [t],
      blocks: [],
      routines: [],
      sleep: SLEEP,
      from: now,
      to,
      now,
    });
    for (const p of proposals) expect(Date.parse(p.end)).toBeLessThanOrEqual(d('2026-09-16T14:00:00+09:00').getTime());
    expect(unplaced[0]?.shortfallMin).toBeGreaterThan(0); // 600분은 다 못 넣는다
  });

  it('급한 것이 먼저 자리를 가져간다', () => {
    const urgent = task({ id: '급함', estimate_min: 120, importance: 5, due_at: '2026-09-16T18:00:00+09:00' });
    const later = task({ id: '나중', estimate_min: 120, importance: 1, due_at: '2026-09-22T18:00:00+09:00' });
    const { proposals } = autoSchedule({
      tasks: [later, urgent],
      blocks: [],
      routines: [],
      sleep: SLEEP,
      from: now,
      to,
      now,
    });
    expect(proposals[0]?.taskId).toBe('급함');
  });

  it('긴 할 일은 여러 세션으로 쪼갠다 (1회 최대 4시간)', () => {
    const t = task({ id: '긴것', estimate_min: 600, due_at: '2026-09-20T23:59:00+09:00' });
    const { proposals } = autoSchedule({
      tasks: [t],
      blocks: [],
      routines: [],
      sleep: SLEEP,
      from: now,
      to,
      now,
    });
    expect(proposals.length).toBeGreaterThan(1);
    for (const p of proposals) expect(p.minutes).toBeLessThanOrEqual(240);
    expect(proposals.reduce((m, p) => m + p.minutes, 0)).toBe(600);
  });

  it('이미 블록이 있는 만큼은 빼고 잡는다', () => {
    const t = task({ id: 'a', estimate_min: 120, due_at: '2026-09-17T23:59:00+09:00' });
    const existing = [block('b1', '2026-09-16T13:00:00+09:00', '2026-09-16T14:00:00+09:00', 'a')];
    const { proposals } = autoSchedule({
      tasks: [t],
      blocks: existing,
      routines: [],
      sleep: SLEEP,
      from: now,
      to,
      now,
    });
    expect(proposals.reduce((m, p) => m + p.minutes, 0)).toBe(60); // 남은 60분만
  });

  it('인박스는 건드리지 않는다', () => {
    const t = task({ id: '인박스', kind: 'someday', estimate_min: 120 });
    const { proposals } = autoSchedule({
      tasks: [t],
      blocks: [],
      routines: [],
      sleep: SLEEP,
      from: now,
      to,
      now,
    });
    expect(proposals).toHaveLength(0);
  });

  it('제안은 15분 격자에 맞는다', () => {
    const odd = d('2026-09-16T09:07:00+09:00');
    const t = task({ id: 'a', estimate_min: 60, due_at: '2026-09-17T23:59:00+09:00' });
    const { proposals } = autoSchedule({
      tasks: [t],
      blocks: [],
      routines: [],
      sleep: SLEEP,
      from: odd,
      to,
      now: odd,
    });
    expect(new Date(proposals[0]!.start).getMinutes() % 15).toBe(0);
  });
});

describe('시각 파싱', () => {
  it('HH:MM', () => {
    expect(parseHhmm('01:00')).toBe(60);
    expect(parseHhmm('23:59')).toBe(1439);
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('9:5')).toBeNull();
  });
});

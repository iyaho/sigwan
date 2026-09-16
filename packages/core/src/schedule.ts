import { DAY_MS, addDays, startOfDay, ymd } from './calendar';
import { MAX_SESSION_MIN, MIN_SESSION_MIN, remainingToSchedule } from './fit';
import { priorityScore } from './score';
import type { Block, Routine, SleepPattern, Task } from './types';

/**
 * 3.8 자동 배치 — 아직 시간을 안 잡은 할 일을 빈 자리에 끼워 넣는다.
 *
 * 세 층으로 나뉜다. 섞으면 테스트가 불가능해진다:
 *   1. 무엇이 막혀 있나  expandRoutines / sleepSpans  → 가상 Block
 *   2. 어디가 비었나     freeSpans                     → 구간 목록
 *   3. 무엇을 넣나       autoSchedule                  → 제안 목록
 *
 * 결과는 제안(Proposal)이지 Block이 아니다. 사용자가 보고 고치고 「적용」을 눌러야 저장된다 —
 * 명세 15장이 "자동 스케줄링 제안"이라고 쓴 이유다. 남의 일정을 말없이 바꾸면 안 된다.
 */

export interface Span {
  start: number; // epoch ms
  end: number;
}

/** 저장되지 않는 가상 Block. id가 'v:'로 시작해 진짜와 구분된다 */
function virtualBlock(id: string, title: string, s: Date, e: Date): Block {
  return {
    id: `v:${id}`,
    user_id: 'local-user',
    task_id: null,
    title,
    start_at: s.toISOString(),
    end_at: e.toISOString(),
    is_all_day: false,
    source: 'import',
    deleted_at: null,
    rev: 0,
  };
}

export const isVirtual = (b: Block) => b.id.startsWith('v:');

/**
 * 고정 일정을 [from, to) 구간의 가상 Block으로 펼친다.
 * 요일은 0=월 … 6=일. Date.getDay()는 0=일이라 변환한다.
 */
export function expandRoutines(routines: Routine[], from: Date, to: Date): Block[] {
  const out: Block[] = [];
  const end = to.getTime();
  for (let d = startOfDay(from); d.getTime() < end; d = addDays(d, 1)) {
    const wd = (d.getDay() + 6) % 7;
    const key = ymd(d);
    for (const r of routines) {
      if (r.deleted_at || !r.weekdays.includes(wd)) continue;
      if (r.active_from && key < r.active_from) continue;
      if (r.active_to && key > r.active_to) continue;
      const s = new Date(d.getTime() + r.start_min * 60_000);
      const e = new Date(d.getTime() + r.end_min * 60_000);
      if (e.getTime() <= from.getTime() || s.getTime() >= end) continue;
      out.push(virtualBlock(`${r.id}:${key}`, r.name, s, e));
    }
  }
  return out;
}

/**
 * 수면을 가상 Block으로. 어느 규칙을 쓸지는 **기상하는 날**의 요일로 정한다.
 * 금요일 밤에서 토요일 아침으로 이어지는 잠은 주말 규칙이다.
 */
export function sleepSpans(sleep: SleepPattern, from: Date, to: Date): Block[] {
  const out: Block[] = [];
  const end = to.getTime();
  // 하루 앞에서 시작한 잠이 from에 걸칠 수 있다
  for (let d = addDays(startOfDay(from), -1); d.getTime() < end; d = addDays(d, 1)) {
    const wakeDay = d.getDay(); // 0=일, 6=토
    const weekend = wakeDay === 0 || wakeDay === 6;
    const st = weekend ? sleep.weekendStart : sleep.weekdayStart;
    const en = weekend ? sleep.weekendEnd : sleep.weekdayEnd;
    // start > end면 전날 밤부터
    const s = new Date(d.getTime() + (st > en ? st - 1440 : st) * 60_000);
    const e = new Date(d.getTime() + en * 60_000);
    if (e.getTime() <= from.getTime() || s.getTime() >= end) continue;
    out.push(virtualBlock(`sleep:${ymd(d)}`, '수면', s, e));
  }
  return out;
}

/** 겹치는 구간을 합친다 */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** [from, to)에서 busy를 뺀 빈 구간 */
export function freeSpans(from: Date, to: Date, busy: Block[]): Span[] {
  const f = from.getTime();
  const t = to.getTime();
  const taken = mergeSpans(
    busy
      .filter((b) => !b.deleted_at)
      .map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) })),
  );
  const out: Span[] = [];
  let cursor = f;
  for (const b of taken) {
    if (b.end <= cursor) continue;
    if (b.start >= t) break;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, t) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= t) break;
  }
  if (cursor < t) out.push({ start: cursor, end: t });
  return out.filter((s) => s.end > s.start);
}

export interface Proposal {
  /** 화면에서 지우거나 옮길 때 쓰는 임시 키 */
  key: string;
  taskId: string;
  title: string;
  start: string;
  end: string;
  minutes: number;
}

export interface AutoScheduleInput {
  tasks: Task[];
  blocks: Block[];
  routines: Routine[];
  sleep: SleepPattern;
  from: Date;
  to: Date;
  now?: Date;
  /** 15분 격자에 맞춘다 */
  snapMinutes?: number;
  maxSessionMin?: number;
  minSessionMin?: number;
  /** 블록 사이에 두는 여유(분). 연속으로 붙여 놓으면 실제로는 못 지킨다 */
  gapMin?: number;
}

export interface AutoScheduleResult {
  proposals: Proposal[];
  /** 자리를 못 찾은 할 일 — 이게 진짜 정보다. "이번 주엔 안 들어간다" */
  unplaced: { taskId: string; title: string; shortfallMin: number; reason: string }[];
  /** 채운 시간(분) / 빈 시간(분) */
  usedMin: number;
  freeMin: number;
}

/**
 * 급한 순으로 앞에서부터 채우는 그리디.
 *
 * 마감이 있는 것만 넣는다 — 인박스(someday)는 날짜가 없어서 "언제까지"가 없고,
 * 그런 걸 자동으로 시간표에 밀어 넣으면 정작 급한 게 밀린다 (3.7.1과 같은 이유).
 */
export function autoSchedule(input: AutoScheduleInput): AutoScheduleResult {
  const {
    tasks,
    blocks,
    routines,
    sleep,
    from,
    to,
    now = new Date(),
    snapMinutes = 15,
    maxSessionMin = MAX_SESSION_MIN,
    minSessionMin = MIN_SESSION_MIN,
    gapMin = 0,
  } = input;

  // 지금보다 과거에는 잡지 않는다
  const start = new Date(Math.max(from.getTime(), now.getTime()));
  const snapUp = (ms: number) => Math.ceil(ms / (snapMinutes * 60_000)) * (snapMinutes * 60_000);

  const busy: Block[] = [
    ...blocks.filter((b) => !b.deleted_at),
    ...expandRoutines(routines, start, to),
    ...sleepSpans(sleep, start, to),
  ];
  let free = freeSpans(start, to, busy);
  const freeMin = free.reduce((m, s) => m + (s.end - s.start) / 60_000, 0);

  const candidates = tasks
    .filter(
      (t) =>
        !t.deleted_at &&
        t.status !== 'done' &&
        t.kind !== 'someday' &&
        remainingToSchedule(t, blocks) >= minSessionMin,
    )
    .sort((a, b) => priorityScore(b, now).score - priorityScore(a, now).score);

  const proposals: Proposal[] = [];
  const unplaced: AutoScheduleResult['unplaced'] = [];
  let usedMin = 0;

  for (const task of candidates) {
    let remain = remainingToSchedule(task, blocks);
    const due = task.due_at
      ? Date.parse(task.due_at)
      : task.day_of
        ? new Date(`${task.day_of}T23:59:59`).getTime()
        : to.getTime();
    let placedAny = false;

    for (let i = 0; i < free.length && remain >= minSessionMin; i++) {
      const span = free[i] as Span;
      // 마감을 넘겨 잡으면 의미가 없다
      const hardEnd = Math.min(span.end, due);
      const s0 = snapUp(span.start);
      if (hardEnd - s0 < minSessionMin * 60_000) continue;

      const take = Math.min(remain, maxSessionMin, (hardEnd - s0) / 60_000);
      const minutes = Math.floor(take / snapMinutes) * snapMinutes;
      if (minutes < minSessionMin) continue;

      const s = new Date(s0);
      const e = new Date(s0 + minutes * 60_000);
      proposals.push({
        key: `${task.id}:${s.toISOString()}`,
        taskId: task.id,
        title: task.title,
        start: s.toISOString(),
        end: e.toISOString(),
        minutes,
      });
      usedMin += minutes;
      remain -= minutes;
      placedAny = true;

      // 이 구간에서 쓴 만큼 잘라낸다 (여유 포함)
      const consumedEnd = e.getTime() + gapMin * 60_000;
      free[i] = { start: consumedEnd, end: span.end };
      if ((free[i] as Span).end - (free[i] as Span).start < minSessionMin * 60_000) {
        free.splice(i, 1);
        i--;
      }
    }

    if (remain >= minSessionMin) {
      unplaced.push({
        taskId: task.id,
        title: task.title,
        shortfallMin: Math.round(remain),
        reason: placedAny ? '일부만 들어감 — 남은 만큼 자리가 없다' : due < start.getTime() ? '마감이 지났다' : '빈 자리가 없다',
      });
    }
  }

  free = free.filter((s) => s.end > s.start);
  return { proposals, unplaced, usedMin, freeMin };
}

/** 제안을 진짜 Block으로. id는 호출하는 쪽에서 붙인다(클라이언트 UUIDv7, 7장) */
export function proposalToBlock(p: Proposal, id: string, userId: string): Block {
  return {
    id,
    user_id: userId,
    task_id: p.taskId,
    title: null,
    start_at: p.start,
    end_at: p.end,
    is_all_day: false,
    source: 'drag',
    deleted_at: null,
    rev: 0,
  };
}

export const WEEKDAY_SHORT = ['월', '화', '수', '목', '금', '토', '일'];

export const hhmm = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const parseHhmm = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
};

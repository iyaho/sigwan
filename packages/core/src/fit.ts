import { DAY_MS, startOfDay } from './calendar';
import type { Block, Task } from './types';

/**
 * 자동 배치 — "이 시각에 이 할 일을 잡는다"의 규칙 하나.
 *
 * 웹 드롭(3.2)·앱 슬롯 선택·나중의 자동 스케줄링(15장)이 전부 여기를 거쳐야 한다.
 * 세 곳에 각각 구현하면 "웹에서 잡은 것과 앱에서 잡은 것의 길이가 다른" 상태가 된다.
 *
 * 핵심은 **블록 길이 ≠ 예상 소요시간**이라는 것이다. 20시간짜리 할 일을 블록 하나에
 * 넣으려 하면 어떤 규칙을 써도 이상해진다 — 잘라내면 쓸모없는 조각이 되고, 안 자르면
 * 사흘치 타임라인을 덮는다. 그래서 여기서 정하는 건 "이번에 얼마나 할 것인가"(세션)다.
 *
 *   길이 = min(아직 안 잡은 작업량, 다음 블록까지의 빈 구간, 하루 끝까지, 1회 최대)
 *
 * 남은 분량은 사라지지 않는다. Task 1:N Block이므로(2장) 다음에 또 잡으면 된다.
 */

/** 1회에 잡는 최대 길이. 20시간짜리가 하루를 통째로 덮지 않게 하는 상한. */
export const MAX_SESSION_MIN = 240;

/** 이보다 짧은 조각은 만들지 않는다. 스냅 단위(15분)와 맞춘다. */
export const MIN_SESSION_MIN = 15;

export interface FitOptions {
  /** 이 시각에 잡으려 한다 */
  start: Date;
  /** 하고 싶은 분량. 보통 remainingToSchedule()의 결과 */
  wantMinutes: number;
  /** 이미 있는 블록들. 삭제된 것은 걸러서 넣어도 되고 안 걸러도 된다 */
  existing: Block[];
  /** 1회 상한. 기본 MAX_SESSION_MIN, null이면 상한 없음 */
  maxMinutes?: number | null;
  /** 최소 길이. 기본 MIN_SESSION_MIN */
  minMinutes?: number;
  /** 자정 대신 다른 하루 끝을 쓰고 싶을 때 */
  dayEnd?: Date;
}

export type FitLimit = 'none' | 'gap' | 'day-end' | 'max-session';

export interface FitResult {
  start: Date;
  end: Date;
  /** 실제로 잡히는 길이(분) */
  minutes: number;
  /** wantMinutes보다 짧아졌는가 */
  truncated: boolean;
  /** 이번에 못 잡은 분량 */
  shortfallMin: number;
  /** 무엇 때문에 짧아졌는가 — UI 문구가 갈린다 */
  limitedBy: FitLimit;
  /** minMinutes조차 안 나와서 만들면 안 되는 경우 */
  tooSmall: boolean;
}

/**
 * 이 할 일에서 아직 시간을 안 잡은 분량.
 * 예상 소요시간에서 이미 한 시간(spent_min)과 이미 잡아둔 블록들을 뺀다.
 */
export function remainingToSchedule(task: Task, blocks: Block[]): number {
  const planned = blocks
    .filter((b) => !b.deleted_at && b.task_id === task.id)
    .reduce((m, b) => m + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000, 0);
  return Math.max(0, task.estimate_min - task.spent_min - planned);
}

export function fitBlock(o: FitOptions): FitResult {
  const {
    start,
    wantMinutes,
    existing,
    maxMinutes = MAX_SESSION_MIN,
    minMinutes = MIN_SESSION_MIN,
  } = o;
  const startMs = start.getTime();
  const dayEndMs = (o.dayEnd ?? new Date(startOfDay(start).getTime() + DAY_MS)).getTime();

  let limit = Math.max(0, wantMinutes);
  let limitedBy: FitLimit = 'none';

  const take = (candidate: number, why: FitLimit) => {
    if (candidate < limit) {
      limit = candidate;
      limitedBy = why;
    }
  };

  if (maxMinutes != null) take(maxMinutes, 'max-session');
  take((dayEndMs - startMs) / 60_000, 'day-end');

  // 시작 시각 뒤에 오는 가장 가까운 블록의 시작까지
  let nextStart = Number.POSITIVE_INFINITY;
  for (const b of existing) {
    if (b.deleted_at) continue;
    const bs = Date.parse(b.start_at);
    const be = Date.parse(b.end_at);
    // 시작 시각이 이미 다른 블록 안에 있으면 빈 구간이 0이다
    if (bs <= startMs && be > startMs) {
      nextStart = startMs;
      break;
    }
    if (bs > startMs && bs < nextStart) nextStart = bs;
  }
  if (Number.isFinite(nextStart)) take((nextStart - startMs) / 60_000, 'gap');

  const minutes = Math.max(0, Math.floor(limit));
  const shortfallMin = Math.max(0, Math.max(0, wantMinutes) - minutes);

  return {
    start,
    end: new Date(startMs + minutes * 60_000),
    minutes,
    truncated: shortfallMin > 0,
    shortfallMin,
    limitedBy: shortfallMin > 0 ? limitedBy : 'none',
    tooSmall: minutes < minMinutes,
  };
}

/** 다음에 minMinutes 이상 비어 있는 시각. 슬롯이 너무 좁을 때 대안을 제시하려고. */
export function nextFreeSlot(
  from: Date,
  needMinutes: number,
  existing: Block[],
  dayEnd?: Date,
): Date | null {
  const dayEndMs = (dayEnd ?? new Date(startOfDay(from).getTime() + DAY_MS)).getTime();
  const live = existing
    .filter((b) => !b.deleted_at)
    .map((b) => ({ s: Date.parse(b.start_at), e: Date.parse(b.end_at) }))
    .sort((a, b) => a.s - b.s);

  let cursor = from.getTime();
  for (const b of live) {
    if (b.e <= cursor) continue;
    if (b.s - cursor >= needMinutes * 60_000) return new Date(cursor);
    cursor = Math.max(cursor, b.e);
  }
  return dayEndMs - cursor >= needMinutes * 60_000 ? new Date(cursor) : null;
}

/** "20시간 중 4시간 잡음 · 16시간 남음" 같은 문구 */
export function fitSummary(fit: FitResult, wantMinutes: number): string {
  const h = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}시간` : `${m}분`);
  if (!fit.truncated) return `${h(fit.minutes)} 잡힘`;
  return `${h(wantMinutes)} 중 ${h(fit.minutes)} 잡힘 · ${h(fit.shortfallMin)} 남음`;
}

export const FIT_LIMIT_LABEL: Record<FitLimit, string> = {
  none: '',
  gap: '다음 일정 전까지',
  'day-end': '자정까지',
  'max-session': '한 번에 최대까지',
};

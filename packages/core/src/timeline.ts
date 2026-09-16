import type { Block } from './types';

/**
 * 설계 명세 3.1 / 3.2 — 간트 좌표계.
 *
 * 화면 좌표는 딱 한 줄로 정의된다:
 *
 *     x = (t − t0) × pxPerMinute
 *
 * 줌 4단계는 전부 `pxPerMinute` 값 하나의 차이일 뿐이다. 줌마다 다른 렌더 경로를
 * 만들면 그 순간 드래그·스냅·겹침이 4벌이 된다.
 *
 * 저장하는 값은 항상 정확한 타임스탬프다. 스냅은 화면에서만 일어난다 (3.2).
 */

export type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

export interface ZoomSpec {
  level: ZoomLevel;
  label: string;
  /** 1분당 픽셀 */
  pxPerMinute: number;
  /** 드래그 스냅 단위(분) */
  snapMinutes: number;
  /** 눈금 간격(분) */
  tickMinutes: number;
  /** 굵은 눈금 간격(분) — 날짜 경계 등 */
  majorTickMinutes: number;
  /** 이 줌에서 세로 타임라인을 쓰는가 (일 뷰는 세로) */
  vertical: boolean;
}

const MIN = 1;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const ZOOMS: Record<ZoomLevel, ZoomSpec> = {
  // 하루를 세로로 펼친다. 1시간 = 72px → 24시간 1728px
  day: {
    level: 'day',
    label: '일',
    pxPerMinute: 72 / HOUR,
    snapMinutes: 15,
    tickMinutes: 15,
    majorTickMinutes: HOUR,
    vertical: true,
  },
  // 하루 폭 58px. 명세 3.1의 "프로토타입에서 나온 수정 후보"가 가리키는 바로 그 값 —
  // 2시간 Block이 4.8px가 된다. 그래서 주 뷰는 읽기 전용으로 둔다.
  week: {
    level: 'week',
    label: '주',
    pxPerMinute: 58 / DAY,
    snapMinutes: HOUR,
    tickMinutes: HOUR * 6,
    majorTickMinutes: DAY,
    vertical: false,
  },
  month: {
    level: 'month',
    label: '월',
    pxPerMinute: 28 / DAY,
    snapMinutes: DAY,
    tickMinutes: DAY,
    majorTickMinutes: WEEK,
    vertical: false,
  },
  quarter: {
    level: 'quarter',
    label: '분기',
    pxPerMinute: 9 / DAY,
    snapMinutes: WEEK,
    tickMinutes: WEEK,
    majorTickMinutes: 4 * WEEK,
    vertical: false,
  },
};

/** 이 줌에서 드래그로 조작 가능한 최소 크기(px). 아래로 내려가면 읽기 전용이 맞다. */
export const MIN_DRAGGABLE_PX = 24;

export function isDraggableAt(zoom: ZoomLevel, durationMin: number): boolean {
  return durationMin * ZOOMS[zoom].pxPerMinute >= MIN_DRAGGABLE_PX;
}

/** 좌표 변환 — 이 두 함수 밖에서 직접 계산하지 않는다 */
export function timeToPx(t: Date | string, origin: Date, zoom: ZoomLevel): number {
  const ms = (typeof t === 'string' ? Date.parse(t) : t.getTime()) - origin.getTime();
  return (ms / 60_000) * ZOOMS[zoom].pxPerMinute;
}

export function pxToTime(px: number, origin: Date, zoom: ZoomLevel): Date {
  return new Date(origin.getTime() + (px / ZOOMS[zoom].pxPerMinute) * 60_000);
}

/** 화면에서만 적용한다. DB에는 스냅되지 않은 정확한 값이 들어간다. */
export function snap(t: Date, zoom: ZoomLevel, enabled = true): Date {
  if (!enabled) return t;
  const step = ZOOMS[zoom].snapMinutes * 60_000;
  return new Date(Math.round(t.getTime() / step) * step);
}

export interface Placed<T> {
  item: T;
  /** 좌표 축 시작(px) — 가로 줌이면 x, 세로(일 뷰)면 y */
  offset: number;
  /** 길이(px) */
  size: number;
  /** 겹침 레인 번호 (0부터) */
  lane: number;
}

/**
 * 겹침 레인 분리 (3.1).
 * 시작 시각 순으로 훑으며 "끝난 레인"에 다시 넣는 그리디. O(n log n).
 * 같은 시각에 겹친 것 중 하나만 밀리는 게 아니라 최소 레인 수가 나온다.
 */
export function layoutBlocks(
  blocks: Block[],
  origin: Date,
  zoom: ZoomLevel,
): { placed: Placed<Block>[]; laneCount: number } {
  const sorted = [...blocks].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const laneEnds: number[] = [];
  const placed: Placed<Block>[] = [];

  for (const b of sorted) {
    const start = Date.parse(b.start_at);
    const end = Date.parse(b.end_at);
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    const offset = timeToPx(b.start_at, origin, zoom);
    const size = Math.max(((end - start) / 60_000) * ZOOMS[zoom].pxPerMinute, 2);
    placed.push({ item: b, offset, size, lane });
  }
  return { placed, laneCount: laneEnds.length };
}

export interface Tick {
  t: Date;
  offset: number;
  major: boolean;
  label: string;
}

/**
 * 눈금 생성. 범위 밖은 만들지 않는다 (분기 뷰에서 수백 개가 된다).
 *
 * 로컬 시간 기준이다. epoch 나머지(ms % DAY)로 자정을 잡으면 UTC 자정 = KST 09:00에
 * 날짜 눈금이 찍힌다 — 실제로 그렇게 됐었다. 하루 이상 단위는 Date의 로컬 setter로 걷는다.
 */
export function ticks(origin: Date, widthPx: number, zoom: ZoomLevel, locale = 'ko-KR'): Tick[] {
  const spec = ZOOMS[zoom];
  const endMs = origin.getTime() + (widthPx / spec.pxPerMinute) * 60_000;
  const out: Tick[] = [];
  const step = spec.tickMinutes;

  // 첫 눈금: origin을 로컬 격자에 내림한 뒤 origin 이상이 될 때까지 한 칸씩 올린다
  const t = new Date(origin);
  if (step >= DAY) {
    t.setHours(0, 0, 0, 0);
    if (step >= WEEK) t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); // 월요일로
  } else {
    t.setSeconds(0, 0);
    t.setMinutes(Math.floor(t.getMinutes() / step) * step);
    if (step >= HOUR) t.setMinutes(0);
    if (step > HOUR) t.setHours(Math.floor(t.getHours() / (step / HOUR)) * (step / HOUR));
  }
  const advance = () => {
    if (step >= WEEK) t.setDate(t.getDate() + 7 * Math.round(step / WEEK));
    else if (step >= DAY) t.setDate(t.getDate() + Math.round(step / DAY));
    else t.setMinutes(t.getMinutes() + step);
  };
  while (t.getTime() < origin.getTime()) advance();

  for (let guard = 0; t.getTime() < endMs && guard < 5000; guard++) {
    const major = isMajor(t, spec.majorTickMinutes);
    out.push({
      t: new Date(t),
      offset: timeToPx(t, origin, zoom),
      major,
      label: tickLabel(t, zoom, locale),
    });
    advance();
  }
  return out;
}

/** 굵은 눈금 판정 — 로컬 시간의 경계로 */
function isMajor(t: Date, majorMinutes: number): boolean {
  if (majorMinutes >= 4 * WEEK) return t.getDate() === 1 && t.getHours() === 0; // 월초
  if (majorMinutes >= WEEK) return t.getDay() === 1 && t.getHours() === 0; // 월요일
  if (majorMinutes >= DAY) return t.getHours() === 0 && t.getMinutes() === 0; // 자정
  return t.getMinutes() === 0; // 정시
}

function tickLabel(t: Date, zoom: ZoomLevel, locale: string): string {
  switch (zoom) {
    case 'day':
      return t.getMinutes() === 0
        ? `${String(t.getHours()).padStart(2, '0')}:00`
        : `${String(t.getMinutes()).padStart(2, '0')}`;
    case 'week':
      return t.getHours() === 0
        ? t.toLocaleDateString(locale, { month: 'numeric', day: 'numeric', weekday: 'short' })
        : `${t.getHours()}시`;
    default:
      return t.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
  }
}

export function isWeekend(t: Date): boolean {
  const d = t.getDay();
  return d === 0 || d === 6;
}

/** 계획 막대(Block)가 기간 막대(start_at~due_at) 밖으로 나갔는가 → 빨간 테두리 (3.1) */
export function isOutOfRange(block: Block, dueAt: string | null): boolean {
  if (!dueAt) return false;
  return Date.parse(block.end_at) > Date.parse(dueAt);
}

import type { ZoomLevel } from './timeline';

/** 날짜 산술 — 전부 로컬 시간. (7장: day_of와 달력 경계는 로컬 날짜) */

export const DAY_MS = 864e5;

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** 월요일 시작 */
export function startOfWeek(d: Date) {
  const s = startOfDay(d);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}
export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

export function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
export function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

/**
 * 줌별로 origin을 달력 경계에 맞추고 [start, end) 범위와 라벨을 준다.
 *  day     하루
 *  week    월~일
 *  month   1일~말일 (달력 격자)
 *  quarter 이번 달부터 3달 (달력 격자 ×3)
 */
export function viewRange(zoom: ZoomLevel, origin: Date): { start: Date; end: Date; label: string } {
  switch (zoom) {
    case 'day': {
      const start = startOfDay(origin);
      return {
        start,
        end: addDays(start, 1),
        label: start.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }),
      };
    }
    case 'week': {
      const start = startOfWeek(origin);
      const end = addDays(start, 7);
      const last = addDays(start, 6);
      const f = (d: Date) => d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
      return { start, end, label: `${f(start)} – ${f(last)}` };
    }
    case 'month': {
      const start = startOfMonth(origin);
      return {
        start,
        end: addMonths(start, 1),
        label: start.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' }),
      };
    }
    default: {
      const start = startOfMonth(origin);
      const end = addMonths(start, 3);
      const last = addMonths(start, 2);
      return {
        start,
        end,
        label: `${start.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })} – ${last.toLocaleDateString('ko-KR', { month: 'long' })}`,
      };
    }
  }
}

/** 이동 단위 — 줌마다 하루 / 일주일 / 한 달 / 세 달 */
export function shiftOrigin(zoom: ZoomLevel, origin: Date, dir: 1 | -1): Date {
  const { start } = viewRange(zoom, origin);
  if (zoom === 'day') return addDays(start, dir);
  if (zoom === 'week') return addDays(start, dir * 7);
  if (zoom === 'month') return addMonths(start, dir);
  return addMonths(start, dir * 3);
}

/** 달력 격자 — 그 달을 덮는 월요일 시작 주들. 6주가 표준이지만 필요한 만큼만 */
export function monthGrid(monthStart: Date): Date[][] {
  const first = startOfWeek(monthStart);
  const end = addMonths(monthStart, 1);
  const weeks: Date[][] = [];
  for (let w = first; w.getTime() < end.getTime(); w = addDays(w, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  }
  return weeks;
}

export const WEEKDAY_KO = ['월', '화', '수', '목', '금', '토', '일'];

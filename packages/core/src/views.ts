import { DAY_MS, startOfDay, ymd } from './calendar';
import type { Block, Task } from './types';

/**
 * 뷰 필터 — "오늘"이 무엇인가를 정하는 곳.
 *
 * 웹 사이드바와 앱 '오늘' 탭이 같은 규칙으로 세야 한다. 원래 apps/web/src/lib/views.ts와
 * apps/mobile/src/views.ts에 같은 내용이 복사돼 있었고, 모바일 쪽 첫 줄에 "웹과 같은 규칙"
 * 이라고 주석까지 달려 있었다 — 명세 11.1이 최대 리스크로 지목한 그 상태라 core로 올렸다.
 */

export type ViewKey = 'today' | 'next7' | 'inbox' | 'done' | 'all';

/** 로컬 날짜 문자열. 달력 쪽 ymd와 같은 값이다 — 이름만 문맥에 맞춰 둘 뿐이다. */
export const localDate = (d: Date = new Date()) => ymd(d);

/**
 * 사이드바 뷰 필터. TaskList와 store(revealTask)가 같은 판단을 해야 하므로 여기 하나만 둔다.
 * 두 곳에 복사하면 "보이는데 안 보인다고 판단하는" 어긋남이 생긴다.
 */
export function filterByView(tasks: Task[], view: ViewKey, now = new Date()): Task[] {
  const live = tasks.filter((t) => !t.deleted_at);
  switch (view) {
    case 'today':
      return live.filter(
        (t) =>
          t.status !== 'done' &&
          (t.day_of === localDate(now) ||
            (!!t.due_at && Date.parse(t.due_at) <= now.getTime() + 864e5)),
      );
    case 'next7':
      return live.filter(
        (t) =>
          t.status !== 'done' && !!t.due_at && Date.parse(t.due_at) <= now.getTime() + 7 * 864e5,
      );
    case 'inbox':
      return live.filter((t) => t.kind === 'someday' && t.status !== 'done');
    case 'done':
      return live.filter((t) => t.status === 'done');
    default:
      return live.filter((t) => t.status !== 'done');
  }
}

/** 그 할 일이 확실히 보이는 뷰 */
export function viewThatShows(t: Task): ViewKey {
  if (t.status === 'done') return 'done';
  if (t.kind === 'someday') return 'inbox';
  return 'all';
}

/**
 * 뷰별 진행도 — 사이드바 탭 옆에 "완료/전체".
 * filterByView는 열린 것만 돌려주므로 여기서는 완료된 것까지 같은 조건으로 센다.
 * 인박스·완료함은 진행도가 성립하지 않아 null.
 */
export function viewProgress(
  tasks: Task[],
  view: ViewKey,
  now = new Date(),
): { done: number; total: number } | null {
  const live = tasks.filter((t) => !t.deleted_at);
  let pool: Task[];
  switch (view) {
    case 'today':
      pool = live.filter(
        (t) =>
          t.kind !== 'someday' &&
          (t.day_of === localDate(now) ||
            (!!t.due_at && Date.parse(t.due_at) <= now.getTime() + 864e5)),
      );
      break;
    case 'next7':
      pool = live.filter(
        (t) => !!t.due_at && Date.parse(t.due_at) <= now.getTime() + 7 * 864e5,
      );
      break;
    case 'all':
      pool = live.filter((t) => t.kind !== 'someday');
      break;
    default:
      return null;
  }
  return { done: pool.filter((t) => t.status === 'done').length, total: pool.length };
}

/**
 * 이 기간에 걸리는 할 일 — 마감(due_at)이 안에 있거나, day_of가 안에 있는 것.
 * 인박스(someday)는 날짜가 없으므로 어느 기간에도 안 걸린다 (2장).
 *
 * 주 스트립·날짜별 리스트·진행도가 전부 이 하나를 기준으로 삼는다. 화면마다 따로 세면
 * "스트립에는 점이 있는데 눌러보면 비어 있는" 상태가 된다.
 */
export function tasksInRange(tasks: Task[], from: Date, to: Date): Task[] {
  const f = from.getTime();
  const t = to.getTime();
  const fDay = localDate(from);
  const tDay = localDate(new Date(t - 1));
  return tasks.filter((x) => {
    if (x.deleted_at || x.kind === 'someday') return false;
    if (x.due_at) {
      const d = Date.parse(x.due_at);
      return d >= f && d < t;
    }
    return !!x.day_of && x.day_of >= fDay && x.day_of <= tDay;
  });
}

/** 하루치. tasksInRange의 흔한 경우를 짧게 쓰려고 */
export function tasksOnDay(tasks: Task[], day: Date): Task[] {
  const start = startOfDay(day);
  return tasksInRange(tasks, start, new Date(start.getTime() + DAY_MS));
}

/** 그 기간에 걸쳐 있는 블록. 경계에 걸친 것도 포함한다 (자정을 넘는 블록) */
export function blocksInRange(blocks: Block[], from: Date, to: Date): Block[] {
  const f = from.getTime();
  const t = to.getTime();
  return blocks
    .filter((b) => !b.deleted_at && Date.parse(b.end_at) > f && Date.parse(b.start_at) < t)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
}

export function blocksOnDay(blocks: Block[], day: Date): Block[] {
  const start = startOfDay(day);
  return blocksInRange(blocks, start, new Date(start.getTime() + DAY_MS));
}

/** 타임라인이 보여주는 기간의 진행도 — 그 기간에 마감(또는 day_of)이 있는 할 일 기준 */
export function rangeProgress(
  tasks: Task[],
  from: Date,
  to: Date,
): { done: number; total: number } {
  const pool = tasksInRange(tasks, from, to);
  return { done: pool.filter((x) => x.status === 'done').length, total: pool.length };
}

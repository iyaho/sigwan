import { DAY_MS, startOfDay, ymd } from './calendar';
import type { Block, Task } from './types';

/**
 * 뷰 필터 — "오늘"이 무엇인가를 정하는 곳.
 *
 * 웹 사이드바와 앱 '오늘' 탭이 같은 규칙으로 세야 한다. 원래 apps/web/src/lib/views.ts와
 * apps/mobile/src/views.ts에 같은 내용이 복사돼 있었고, 모바일 쪽 첫 줄에 "웹과 같은 규칙"
 * 이라고 주석까지 달려 있었다 — 명세 11.1이 최대 리스크로 지목한 그 상태라 core로 올렸다.
 */

export type ViewKey = 'today' | 'next7' | 'month' | 'inbox' | 'done' | 'all';

/**
 * 「월」은 달력상 이번 달이 아니라 **앞으로 30일**이다.
 *
 * next7이 "앞으로 7일"이라 결이 맞고, 무엇보다 달력 기준으로 잡으면 월말에 목록이 텅 비었다가
 * 1일 아침에 갑자기 서른 개가 된다. 달력 화면(3.1)은 달 경계가 맞지만 이건 목록이라 아니다.
 */
export const MONTH_DAYS = 30;

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
    case 'month':
      return live.filter(
        (t) =>
          t.status !== 'done' &&
          !!t.due_at &&
          Date.parse(t.due_at) <= now.getTime() + MONTH_DAYS * 864e5,
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
    case 'month':
      pool = live.filter(
        (t) => !!t.due_at && Date.parse(t.due_at) <= now.getTime() + MONTH_DAYS * 864e5,
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

/**
 * 완료함을 완료한 **날짜별로** 묶는다.
 *
 * 하나의 긴 목록이면 어제 끝낸 것과 석 달 전 것이 같은 무게로 섞여서, 쌓일수록 못 쓰게 된다.
 * 날짜로 끊으면 "언제 끝냈나"가 목록의 구조 자체가 된다.
 *
 * 개수를 자르지 않는다 — 화면이 SectionList로 보이는 것만 그리고, 옛것은 검색으로 찾는다.
 * completed_at이 없는 옛 데이터는 버리지 않고 맨 아래 「날짜 없음」으로 모은다.
 */
export interface CompletedGroup {
  /** YYYY-MM-DD, 날짜를 모르면 '' */
  day: string;
  label: string;
  tasks: Task[];
}

export function completedGroups(tasks: Task[], now = new Date()): CompletedGroup[] {
  const done = tasks.filter((t) => !t.deleted_at && t.status === 'done');
  const byDay = new Map<string, Task[]>();
  for (const t of done) {
    // 로컬 날짜로 끊는다. UTC로 자르면 자정 근처에 끝낸 것이 어제로 밀린다 (7장)
    const key = t.completed_at ? localDate(new Date(t.completed_at)) : '';
    const arr = byDay.get(key);
    if (arr) arr.push(t);
    else byDay.set(key, [t]);
  }

  const today = localDate(now);
  const yesterday = localDate(new Date(now.getTime() - DAY_MS));

  return [...byDay.entries()]
    .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : b[0].localeCompare(a[0])))
    .map(([day, list]) => ({
      day,
      label: day === '' ? '날짜 없음' : day === today ? '오늘' : day === yesterday ? '어제' : dayLabel(day),
      // 그룹 안은 늦게 끝낸 것부터
      tasks: list.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')),
    }));
}

const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-09-15' → '9월 15일 (월)'. Date로 파싱할 때 T00:00:00을 붙여야 로컬로 읽힌다 */
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_LABEL[d.getDay()]})`;
}

/**
 * 검색 규칙 — 제목·메모 부분 일치, 대소문자 무시.
 * 웹과 앱이 각각 구현하면 "웹에서는 찾히는데 폰에서는 안 찾히는" 상태가 된다.
 */
export function matchesQuery(t: Task, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return t.title.toLowerCase().includes(s) || (t.notes ?? '').toLowerCase().includes(s);
}

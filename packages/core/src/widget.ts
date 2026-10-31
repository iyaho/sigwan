import { GRADE_COLOR, priorityScore, sortByPriority } from './score';
import type { Task } from './types';
import { filterByView, isInToday, localDate, viewProgress } from './views';

/**
 * 3.5 「오늘」 위젯에 들어갈 내용. 위젯 쪽 코드는 이걸 그리기만 한다.
 *
 * 앱 일정 탭의 「오늘」과 같은 함수(filterByView · viewProgress · sortByPriority)로 센다.
 * 위젯이 3/8이라 하고 앱이 4/8이라 하면 둘 중 하나는 거짓말이다 (3.5, 11.1).
 */

export const TODAY_WIDGET_LIMIT = 5;

export interface TodayWidgetItem {
  id: string;
  title: string;
  done: boolean;
  /** 등급색. 끝낸 것은 null */
  color: string | null;
  /** '14:00' · '내일 09:00' · '지남' · '' */
  meta: string;
}

export interface TodayWidgetData {
  /** '10월 20일 (화)' */
  dateLabel: string;
  done: number;
  total: number;
  items: TodayWidgetItem[];
  /** 자리가 없어 못 보여준 열린 할 일 수 */
  more: number;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function metaOf(t: Task, now: Date): string {
  if (t.status === 'done' || !t.due_at) return '';
  const due = new Date(t.due_at);
  if (due.getTime() < now.getTime()) return '지남';
  return localDate(due) === localDate(now) ? hhmm(due) : `내일 ${hhmm(due)}`;
}

export function todayWidgetData(
  tasks: Task[],
  now = new Date(),
  limit = TODAY_WIDGET_LIMIT,
): TodayWidgetData {
  const open = sortByPriority(filterByView(tasks, 'today', now), now);
  const shownOpen = open.slice(0, limit);

  /**
   * 위젯에서 체크하면 그 줄이 바로 목록에서 빠진다. 잘못 눌렀을 때 되돌릴 길이 없어지므로
   * 오늘 끝낸 것을 남는 자리에 채워 둔다 — 다시 누르면 되살아난다.
   * 오늘 끝냈어도 「오늘」에 안 걸리는 할 일(다음 주 마감 등)은 위 숫자에 안 들어가니 여기도 안 넣는다.
   */
  const today = localDate(now);
  const doneToday = tasks
    .filter(
      (t) =>
        !t.deleted_at &&
        t.status === 'done' &&
        !!t.completed_at &&
        localDate(new Date(t.completed_at)) === today &&
        isInToday(t, now),
    )
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    .slice(0, limit - shownOpen.length);

  const prog = viewProgress(tasks, 'today', now) ?? { done: 0, total: 0 };

  return {
    dateLabel: `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAY[now.getDay()]})`,
    done: prog.done,
    total: prog.total,
    items: [...shownOpen, ...doneToday].map((t) => ({
      id: t.id,
      title: t.title,
      done: t.status === 'done',
      color: t.status === 'done' ? null : GRADE_COLOR[priorityScore(t, now).grade],
      meta: metaOf(t, now),
    })),
    more: open.length - shownOpen.length,
  };
}

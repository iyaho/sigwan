import type { Task } from '@sigwan/core';

export type ViewKey = 'today' | 'next7' | 'inbox' | 'done' | 'all';

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

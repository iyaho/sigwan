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

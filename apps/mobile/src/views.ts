import type { Task } from '@sigwan/core';

/** apps/web/src/lib/views.ts와 같은 규칙. 두 앱이 '오늘'을 다르게 세면 안 된다. */
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function todayTasks(tasks: Task[], now = new Date()) {
  return tasks.filter(
    (t) =>
      !t.deleted_at &&
      t.status !== 'done' &&
      (t.day_of === localDate(now) || (!!t.due_at && Date.parse(t.due_at) <= now.getTime() + 864e5)),
  );
}

export function todayProgress(tasks: Task[], now = new Date()) {
  const pool = tasks.filter(
    (t) =>
      !t.deleted_at &&
      t.kind !== 'someday' &&
      (t.day_of === localDate(now) || (!!t.due_at && Date.parse(t.due_at) <= now.getTime() + 864e5)),
  );
  return { done: pool.filter((t) => t.status === 'done').length, total: pool.length };
}

/** 기간 안에 마감이 있는 할 일의 진행도 — 웹 rangeProgress와 같은 규칙 */
export function rangeProgressOf(tasks: Task[], from: Date, to: Date) {
  const f = from.getTime();
  const t = to.getTime();
  const fDay = localDate(from);
  const tDay = localDate(new Date(t - 1));
  const pool = tasks.filter((x) => {
    if (x.deleted_at || x.kind === 'someday') return false;
    if (x.due_at) {
      const d = Date.parse(x.due_at);
      return d >= f && d < t;
    }
    return !!x.day_of && x.day_of >= fDay && x.day_of <= tDay;
  });
  return { done: pool.filter((x) => x.status === 'done').length, total: pool.length };
}

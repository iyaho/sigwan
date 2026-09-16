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

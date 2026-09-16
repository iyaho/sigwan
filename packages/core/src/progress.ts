import type { Task } from './types';

/**
 * 3.6 — 하위작업은 같은 테이블에 parent_id로 붙고, 부모 progress는 자동 계산이다.
 *
 * progress = 완료된 직계 자식 수 / 직계 자식 수 (0~1).
 * 자식이 없으면 부모 자신의 status로 판단한다 (done이면 1, 아니면 0).
 * 손자까지 재귀하지 않는다 — 한 단계면 충분하고, 재귀하면 순환 참조에 방어 코드가 필요해진다.
 */
export function childrenOf(parentId: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.parent_id === parentId && !t.deleted_at);
}

export function progressOf(task: Task, tasks: Task[]): number {
  const kids = childrenOf(task.id, tasks);
  if (kids.length === 0) return task.status === 'done' ? 1 : 0;
  const done = kids.filter((k) => k.status === 'done').length;
  return done / kids.length;
}

/** 자식이 바뀐 뒤 부모에 써 넣을 값. 부모가 없거나 안 바뀌면 null. */
export function parentUpdate(child: Task, tasks: Task[]): Task | null {
  if (!child.parent_id) return null;
  const parent = tasks.find((t) => t.id === child.parent_id);
  if (!parent) return null;
  const next = progressOf(parent, tasks);
  return Math.abs(next - parent.progress) < 1e-9 ? null : { ...parent, progress: next };
}

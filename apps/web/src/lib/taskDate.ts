import type { Task } from '@sigwan/core';

/**
 * 명세 3.3-3 — kind를 사용자가 고르지 않는다. 날짜/시각 입력이 결정한다.
 *
 *   날짜 없음      → someday (인박스, 정렬 제외)
 *   날짜만         → day     (그날 하루 할 일, 암묵 마감 23:59)
 *   날짜 + 시각    → deadline
 *
 * 추가 폼과 상세 편집이 같은 규칙을 써야 한다. 한쪽만 고치면 "추가할 땐 하루 할 일인데
 * 나중에 고치면 기한 투두가 되는" 식으로 어긋난다.
 */
export type DueFields = Pick<Task, 'kind' | 'day_of' | 'due_at'>;

export function dueFields(dateStr: string | null, timeStr: string): DueFields {
  if (!dateStr) return { kind: 'someday', day_of: null, due_at: null };
  if (!timeStr) return { kind: 'day', day_of: dateStr, due_at: null };
  return {
    kind: 'deadline',
    day_of: null,
    due_at: new Date(`${dateStr}T${timeStr}:00`).toISOString(),
  };
}

/** 반대 방향 — 저장된 Task를 date/time 입력 두 칸으로 푼다 */
export function dueParts(t: Pick<Task, 'kind' | 'day_of' | 'due_at'>): {
  dateStr: string;
  timeStr: string;
} {
  if (t.due_at) {
    const d = new Date(t.due_at);
    return {
      dateStr: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
      timeStr: `${p2(d.getHours())}:${p2(d.getMinutes())}`,
    };
  }
  return { dateStr: t.day_of ?? '', timeStr: '' };
}

const p2 = (n: number) => String(n).padStart(2, '0');

export const KIND_LABEL: Record<Task['kind'], string> = {
  day: '하루 투두',
  deadline: '기한 투두',
  someday: '인박스',
};

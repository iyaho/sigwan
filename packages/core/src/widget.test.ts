import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import { filterByView, viewProgress } from './views';
import { todayWidgetData } from './widget';

const NOW = new Date('2026-09-16T10:00:00+09:00');
const TODAY = '2026-09-16';

function task(over: Partial<Task>): Task {
  return {
    id: over.id ?? 't',
    user_id: 'u1',
    title: over.id ?? 'x',
    notes: null,
    kind: 'deadline',
    status: 'todo',
    day_of: null,
    start_at: null,
    due_at: null,
    estimate_min: 60,
    spent_min: 0,
    importance: 3,
    progress: 0,
    pinned: false,
    parent_id: null,
    rrule: null,
    sort_order: 1,
    score: null,
    source: 'manual',
    estimate_is_ai: false,
    is_locked: false,
    enc_blob: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    completed_at: null,
    deleted_at: null,
    rev: 0,
    ...over,
  } as Task;
}

const at = (s: string) => new Date(s).toISOString();

describe('todayWidgetData — 앱 「오늘」과 같은 답', () => {
  const tasks = [
    task({ id: 'soon', due_at: at('2026-09-16T12:00:00+09:00'), importance: 5 }),
    task({ id: 'late', due_at: at('2026-09-16T22:00:00+09:00') }),
    task({ id: 'tmrw', due_at: at('2026-09-17T09:00:00+09:00') }),
    task({ id: 'over', due_at: at('2026-09-15T18:00:00+09:00') }),
    task({ id: 'dayof', kind: 'day', day_of: TODAY }),
    task({ id: 'nextweek', due_at: at('2026-09-23T09:00:00+09:00') }),
    task({ id: 'inbox', kind: 'someday' }),
    task({ id: 'gone', kind: 'day', day_of: TODAY, deleted_at: NOW.toISOString() }),
    task({
      id: 'doneToday',
      kind: 'day',
      day_of: TODAY,
      status: 'done',
      completed_at: at('2026-09-16T09:00:00+09:00'),
    }),
  ];

  it('완료 수·전체 수는 viewProgress와 같다', () => {
    const d = todayWidgetData(tasks, NOW);
    expect({ done: d.done, total: d.total }).toEqual(viewProgress(tasks, 'today', NOW));
  });

  it('열린 할 일은 급한 순 앞에서 다섯 개, 나머지는 more', () => {
    const d = todayWidgetData(tasks, NOW);
    const open = filterByView(tasks, 'today', NOW);
    expect(open).toHaveLength(5);
    expect(d.items.filter((i) => !i.done).map((i) => i.id)).toHaveLength(5);
    expect(d.more).toBe(0);

    const d3 = todayWidgetData(tasks, NOW, 3);
    expect(d3.items).toHaveLength(3);
    expect(d3.more).toBe(2);
    expect(d3.items.every((i) => !i.done)).toBe(true);
  });

  it('남는 자리에는 오늘 끝낸 것 — 위젯에서 잘못 눌러도 되돌릴 수 있게', () => {
    const d = todayWidgetData(tasks, NOW, 6);
    expect(d.items.at(-1)).toMatchObject({ id: 'doneToday', done: true, color: null });
  });

  it('어제 끝낸 것, 오늘에 안 걸리는 것은 채우지 않는다', () => {
    const d = todayWidgetData(
      [
        task({
          id: 'yday',
          kind: 'day',
          day_of: TODAY,
          status: 'done',
          completed_at: at('2026-09-15T23:00:00+09:00'),
        }),
        task({
          id: 'farDone',
          due_at: at('2026-09-30T09:00:00+09:00'),
          status: 'done',
          completed_at: at('2026-09-16T08:00:00+09:00'),
        }),
      ],
      NOW,
    );
    expect(d.items).toEqual([]);
  });

  it('지운 것과 인박스는 안 나온다', () => {
    const ids = todayWidgetData(tasks, NOW, 20).items.map((i) => i.id);
    expect(ids).not.toContain('gone');
    expect(ids).not.toContain('inbox');
    expect(ids).not.toContain('nextweek');
  });

  it('마감 표시 — 오늘은 시각, 내일은 「내일」, 지난 건 「지남」, day_of만 있으면 비움', () => {
    const meta = Object.fromEntries(
      todayWidgetData(tasks, NOW, 20).items.map((i) => [i.id, i.meta]),
    );
    expect(meta).toMatchObject({
      soon: '12:00',
      late: '22:00',
      tmrw: '내일 09:00',
      over: '지남',
      dayof: '',
    });
  });

  it('날짜는 로컬 기준', () => {
    // 2026-09-16 00:30 KST = 09-15 15:30 UTC. UTC로 찍으면 15일이 된다
    expect(todayWidgetData([], new Date('2026-09-16T00:30:00+09:00')).dateLabel).toBe(
      '9월 16일 (수)',
    );
  });
});

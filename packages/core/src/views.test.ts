import { describe, expect, it } from 'vitest';
import {
  blocksOnDay,
  completedGroups,
  filterByView,
  matchesQuery,
  rangeProgress,
  tasksInRange,
  tasksOnDay,
  viewProgress,
} from './views';
import type { Block, Task } from './types';

const DAY = new Date('2026-09-16T00:00:00+09:00');

function task(over: Partial<Task>): Task {
  return {
    id: over.id ?? 't',
    user_id: 'u1',
    title: 'x',
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
    created_at: DAY.toISOString(),
    updated_at: DAY.toISOString(),
    completed_at: null,
    deleted_at: null,
    rev: 0,
    ...over,
  } as Task;
}

const block = (id: string, s: string, e: string): Block => ({
  id,
  user_id: 'u1',
  task_id: null,
  title: id,
  start_at: new Date(s).toISOString(),
  end_at: new Date(e).toISOString(),
  is_all_day: false,
  source: 'manual',
  deleted_at: null,
  rev: 0,
});

describe('기간에 걸리는 할 일', () => {
  it('마감이 그 날이면 포함', () => {
    const t = task({ due_at: '2026-09-16T23:59:00+09:00' });
    expect(tasksOnDay([t], DAY)).toHaveLength(1);
  });

  it('day_of로도 잡힌다 — 로컬 날짜 기준', () => {
    const t = task({ kind: 'day', due_at: null, day_of: '2026-09-16' });
    expect(tasksOnDay([t], DAY)).toHaveLength(1);
  });

  it('자정 직후 마감은 그 다음 날이다 (UTC로 새면 여기가 깨진다)', () => {
    const t = task({ due_at: '2026-09-17T00:30:00+09:00' });
    expect(tasksOnDay([t], DAY)).toHaveLength(0);
  });

  it('인박스는 어느 기간에도 안 걸린다', () => {
    const t = task({ kind: 'someday', due_at: null, day_of: null });
    expect(tasksOnDay([t], DAY)).toHaveLength(0);
  });

  it('삭제된 것은 빠진다', () => {
    const t = task({ due_at: '2026-09-16T10:00:00+09:00', deleted_at: DAY.toISOString() });
    expect(tasksOnDay([t], DAY)).toHaveLength(0);
  });

  it('주 단위로도 같은 규칙', () => {
    const inWeek = task({ id: 'a', due_at: '2026-09-18T10:00:00+09:00' });
    const outWeek = task({ id: 'b', due_at: '2026-09-25T10:00:00+09:00' });
    const start = new Date('2026-09-14T00:00:00+09:00');
    const end = new Date('2026-09-21T00:00:00+09:00');
    expect(tasksInRange([inWeek, outWeek], start, end).map((t) => t.id)).toEqual(['a']);
  });
});

describe('진행도는 같은 풀을 쓴다', () => {
  it('완료/전체', () => {
    const a = task({ id: 'a', due_at: '2026-09-16T10:00:00+09:00', status: 'done' });
    const b = task({ id: 'b', due_at: '2026-09-16T12:00:00+09:00' });
    const end = new Date('2026-09-17T00:00:00+09:00');
    expect(rangeProgress([a, b], DAY, end)).toEqual({ done: 1, total: 2 });
  });
});

describe('그 날의 블록', () => {
  it('자정을 넘는 블록은 양쪽 날에 걸린다', () => {
    const b = block('b1', '2026-09-16T23:00:00+09:00', '2026-09-17T01:00:00+09:00');
    expect(blocksOnDay([b], DAY)).toHaveLength(1);
    expect(blocksOnDay([b], new Date('2026-09-17T00:00:00+09:00'))).toHaveLength(1);
  });

  it('시작 시각 순으로 정렬된다', () => {
    const late = block('late', '2026-09-16T15:00:00+09:00', '2026-09-16T16:00:00+09:00');
    const early = block('early', '2026-09-16T09:00:00+09:00', '2026-09-16T10:00:00+09:00');
    expect(blocksOnDay([late, early], DAY).map((b) => b.id)).toEqual(['early', 'late']);
  });
});

describe('오늘 필터는 그대로 동작한다', () => {
  it('완료된 것은 오늘에서 빠진다', () => {
    const now = new Date('2026-09-16T12:00:00+09:00');
    const done = task({ id: 'a', kind: 'day', day_of: '2026-09-16', status: 'done' });
    const open = task({ id: 'b', kind: 'day', day_of: '2026-09-16' });
    expect(filterByView([done, open], 'today', now).map((t) => t.id)).toEqual(['b']);
  });
});

describe('월 뷰 — 앞으로 30일', () => {
  const now = new Date('2026-09-16T12:00:00+09:00');
  const at = (days: number) => new Date(now.getTime() + days * 864e5).toISOString();

  it('30일 안은 들어오고 그 밖은 빠진다', () => {
    const list = [
      task({ id: '내일', due_at: at(1) }),
      task({ id: '20일뒤', due_at: at(20) }),
      task({ id: '40일뒤', due_at: at(40) }),
      task({ id: '인박스', kind: 'someday' }),
    ];
    const ids = filterByView(list, 'month', now).map((t) => t.id);
    expect(ids).toEqual(['내일', '20일뒤']);
  });

  it('달 경계에 흔들리지 않는다 — 말일에도 다음 달 것이 보인다', () => {
    // 9/30에 서면 10/20 마감도 30일 안이다. 달력 기준이면 안 보였을 것이다
    const last = new Date('2026-09-30T12:00:00+09:00');
    const list = [task({ id: '다음달', due_at: '2026-10-20T12:00:00+09:00' })];
    expect(filterByView(list, 'month', last).map((t) => t.id)).toEqual(['다음달']);
  });

  it('진행도는 완료된 것까지 같은 조건으로 센다', () => {
    const list = [
      task({ id: 'a', due_at: at(3) }),
      task({ id: 'b', due_at: at(3), status: 'done' }),
      task({ id: 'c', due_at: at(99) }),
    ];
    expect(viewProgress(list, 'month', now)).toEqual({ done: 1, total: 2 });
  });
});

describe('완료함 날짜별 묶기', () => {
  const now = new Date('2026-09-17T10:00:00+09:00');
  const done = (id: string, at: string | null) =>
    task({ id, status: 'done', completed_at: at });

  it('오늘·어제는 이름으로, 그 앞은 날짜로 라벨이 붙는다', () => {
    const g = completedGroups(
      [
        done('a', '2026-09-17T09:00:00+09:00'),
        done('b', '2026-09-16T20:00:00+09:00'),
        done('c', '2026-09-14T11:00:00+09:00'),
      ],
      now,
    );
    expect(g.map((x) => x.label)).toEqual(['오늘', '어제', '9월 14일 (월)']);
  });

  it('자정 직전에 끝낸 것은 그 날에 남는다 — UTC로 자르면 어제로 밀린다', () => {
    const g = completedGroups([done('a', '2026-09-17T23:50:00+09:00')], now);
    expect(g[0]?.day).toBe('2026-09-17');
  });

  it('완료 시각이 없는 옛 데이터는 버리지 않고 맨 아래로', () => {
    const g = completedGroups([done('a', '2026-09-17T09:00:00+09:00'), done('old', null)], now);
    expect(g[g.length - 1]?.label).toBe('날짜 없음');
    expect(g).toHaveLength(2);
  });

  it('그룹 안은 늦게 끝낸 것부터', () => {
    const g = completedGroups(
      [done('아침', '2026-09-17T08:00:00+09:00'), done('저녁', '2026-09-17T19:00:00+09:00')],
      now,
    );
    expect(g[0]?.tasks.map((t) => t.id)).toEqual(['저녁', '아침']);
  });

  it('완료 안 된 것은 안 들어온다', () => {
    expect(completedGroups([task({ id: 'x' })], now)).toEqual([]);
  });
});

describe('검색', () => {
  it('제목과 메모를 대소문자 무시로 본다', () => {
    const t = task({ id: 'a', title: 'OS 과제', notes: '3장까지' });
    expect(matchesQuery(t, 'os')).toBe(true);
    expect(matchesQuery(t, '3장')).toBe(true);
    expect(matchesQuery(t, '알고리즘')).toBe(false);
  });

  it('빈 검색어는 전부 통과시킨다', () => {
    expect(matchesQuery(task({ id: 'a' }), '   ')).toBe(true);
  });
});

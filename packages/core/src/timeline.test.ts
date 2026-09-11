import { describe, expect, it } from 'vitest';
import { ZOOMS, isDraggableAt, layoutBlocks, pxToTime, snap, ticks, timeToPx } from './timeline';
import type { Block } from './types';

const ORIGIN = new Date('2026-09-02T00:00:00+09:00');

function block(id: string, start: string, end: string): Block {
  return {
    id,
    user_id: 'u1',
    task_id: null,
    title: id,
    start_at: start,
    end_at: end,
    is_all_day: false,
    source: 'manual',
    deleted_at: null,
    rev: 0,
  };
}

describe('좌표 변환', () => {
  it('일 뷰에서 1시간은 72px', () => {
    expect(timeToPx('2026-09-02T01:00:00+09:00', ORIGIN, 'day')).toBeCloseTo(72, 5);
  });

  it('주 뷰에서 하루는 58px', () => {
    expect(timeToPx('2026-09-03T00:00:00+09:00', ORIGIN, 'week')).toBeCloseTo(58, 5);
  });

  it('timeToPx / pxToTime 왕복', () => {
    for (const z of ['day', 'week', 'month', 'quarter'] as const) {
      const t = new Date('2026-09-05T13:37:00+09:00');
      expect(pxToTime(timeToPx(t, ORIGIN, z), ORIGIN, z).getTime()).toBeCloseTo(t.getTime(), -1);
    }
  });
});

describe('스냅', () => {
  it('일 뷰는 15분 단위', () => {
    const t = new Date('2026-09-02T10:07:00+09:00');
    expect(snap(t, 'day').toISOString()).toBe(new Date('2026-09-02T10:00:00+09:00').toISOString());
    const t2 = new Date('2026-09-02T10:08:00+09:00');
    expect(snap(t2, 'day').toISOString()).toBe(
      new Date('2026-09-02T10:15:00+09:00').toISOString(),
    );
  });

  it('Alt 누르면(enabled=false) 스냅하지 않는다', () => {
    const t = new Date('2026-09-02T10:07:00+09:00');
    expect(snap(t, 'day', false).getTime()).toBe(t.getTime());
  });
});

describe('주 뷰가 조작 불가능하다는 사실 (명세 3.1 수정 후보)', () => {
  it('2시간 Block은 주 뷰에서 5px 미만이다', () => {
    expect(120 * ZOOMS.week.pxPerMinute).toBeLessThan(5);
    expect(isDraggableAt('week', 120)).toBe(false);
    expect(isDraggableAt('day', 120)).toBe(true);
  });
});

describe('겹침 레인', () => {
  it('겹치지 않으면 전부 레인 0', () => {
    const r = layoutBlocks(
      [
        block('a', '2026-09-02T09:00:00+09:00', '2026-09-02T10:00:00+09:00'),
        block('b', '2026-09-02T10:00:00+09:00', '2026-09-02T11:00:00+09:00'),
      ],
      ORIGIN,
      'day',
    );
    expect(r.laneCount).toBe(1);
    expect(r.placed.map((p) => p.lane)).toEqual([0, 0]);
  });

  it('셋이 겹치면 레인 3개', () => {
    const r = layoutBlocks(
      [
        block('a', '2026-09-02T09:00:00+09:00', '2026-09-02T12:00:00+09:00'),
        block('b', '2026-09-02T10:00:00+09:00', '2026-09-02T11:00:00+09:00'),
        block('c', '2026-09-02T10:30:00+09:00', '2026-09-02T13:00:00+09:00'),
      ],
      ORIGIN,
      'day',
    );
    expect(r.laneCount).toBe(3);
  });

  it('끝난 레인은 재사용한다', () => {
    const r = layoutBlocks(
      [
        block('a', '2026-09-02T09:00:00+09:00', '2026-09-02T10:00:00+09:00'),
        block('b', '2026-09-02T09:30:00+09:00', '2026-09-02T10:30:00+09:00'),
        block('c', '2026-09-02T10:00:00+09:00', '2026-09-02T11:00:00+09:00'),
      ],
      ORIGIN,
      'day',
    );
    expect(r.laneCount).toBe(2);
    expect(r.placed.find((p) => p.item.id === 'c')?.lane).toBe(0);
  });

  it('0분짜리도 최소 2px은 그린다', () => {
    const r = layoutBlocks(
      [block('a', '2026-09-02T09:00:00+09:00', '2026-09-02T09:00:30+09:00')],
      ORIGIN,
      'quarter',
    );
    expect(r.placed[0]?.size).toBe(2);
  });
});

describe('눈금', () => {
  it('격자에 맞춰 생성된다 (origin이 어긋나도)', () => {
    const odd = new Date('2026-09-02T00:07:00+09:00');
    const t = ticks(odd, 720, 'day');
    expect(t.length).toBeGreaterThan(0);
    expect(t[0]?.t.getMinutes() % 15).toBe(0);
  });

  it('폭을 넘는 눈금은 만들지 않는다', () => {
    const t = ticks(ORIGIN, 288, 'day'); // 4시간치
    expect(t.at(-1)?.offset).toBeLessThanOrEqual(288);
  });
});

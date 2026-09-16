import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORE_CONFIG, gradeOf, priorityScore, sortByPriority } from './score';
import type { Task } from './types';

/**
 * 설계 명세 4장 "검산" 표 그대로가 첫 테스트다.
 * 이 다섯 줄이 깨지면 정렬이 명세와 달라진 것이고, 웹·앱·위젯이 동시에 어긋난다.
 */

const NOW = new Date('2026-09-02T14:00:00+09:00');

function task(p: Partial<Task> & { title: string }): Task {
  return {
    id: p.title,
    user_id: 'u1',
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
    sort_order: 0,
    score: null,
    source: 'manual',
    estimate_is_ai: false,
    is_locked: false,
    enc_blob: null,
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    completed_at: null,
    deleted_at: null,
    rev: 0,
    ...p,
  };
}

const 학회비 = task({
  title: '학회비 납부',
  due_at: '2026-08-31T23:59:00+09:00',
  estimate_min: 12,
  importance: 3,
});
const 발표자료 = task({
  title: 'SINE 발표자료',
  due_at: '2026-09-03T09:00:00+09:00',
  estimate_min: 240,
  importance: 4,
});
const 설거지 = task({
  title: '설거지',
  kind: 'day',
  day_of: '2026-09-02',
  estimate_min: 30,
  importance: 2,
});
const 운영체제 = task({
  title: '운영체제 과제',
  due_at: '2026-09-04T23:59:00+09:00',
  estimate_min: 360,
  importance: 5,
});
// 명세는 마감을 "10-15"로만 적었다. 표의 slack 1012h를 재현하는 시각은 14:00이다.
const 포폴 = task({
  title: '포폴 리뉴얼',
  due_at: '2026-10-15T14:00:00+09:00',
  estimate_min: 1200,
  importance: 3,
});

describe('4장 검산표', () => {
  const rows = [
    { t: 학회비, slack: null, U: 100, I: 50, score: 110.0, grade: 'now' },
    { t: 발표자료, slack: 15.0, U: 76.2, I: 75, score: 75.7, grade: 'today' },
    { t: 설거지, slack: 9.5, U: 83.5, I: 25, score: 70.1, grade: 'today' },
    { t: 운영체제, slack: 52.0, U: 48.0, I: 100, score: 68.8, grade: 'week' },
    { t: 포폴, slack: 1012.0, U: 4.5, I: 50, score: 22.7, grade: 'later' },
  ] as const;

  for (const row of rows) {
    it(`${row.t.title} → ${row.score} (${row.grade})`, () => {
      const r = priorityScore(row.t, NOW);
      expect(r.score).toBeCloseTo(row.score, 1);
      expect(r.urgency).toBeCloseTo(row.U, 1);
      expect(r.importance).toBe(row.I);
      expect(r.grade).toBe(row.grade);
      if (row.slack !== null) expect(r.slackHours as number).toBeCloseTo(row.slack, 1);
    });
  }

  it('정렬 순서가 명세 표와 같다', () => {
    const sorted = sortByPriority([포폴, 운영체제, 설거지, 발표자료, 학회비], NOW);
    expect(sorted.map((t) => t.title)).toEqual([
      '학회비 납부',
      'SINE 발표자료',
      '설거지',
      '운영체제 과제',
      '포폴 리뉴얼',
    ]);
  });

  it('검토 항목: 설거지(kind=day +10)가 운영체제 과제를 이긴다', () => {
    // 명세가 "납득되는가"로 남겨둔 지점. 부스트 값을 건드리면 여기가 먼저 깨진다.
    expect(priorityScore(설거지, NOW).score).toBeGreaterThan(priorityScore(운영체제, NOW).score);
  });
});

describe('정렬 제외 규칙', () => {
  it('someday(=AI 초안 포함)는 점수 정렬에서 빠진다', () => {
    const draft = task({
      title: 'AI 초안',
      kind: 'someday',
      source: 'ai',
      estimate_is_ai: true,
      importance: 5,
    });
    expect(priorityScore(draft, NOW).score).toBe(Number.NEGATIVE_INFINITY);
    expect(sortByPriority([draft, 포폴], NOW)[0]?.title).toBe('포폴 리뉴얼');
  });

  it('done은 빠진다', () => {
    expect(priorityScore(task({ title: 'x', status: 'done' }), NOW).score).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it('pinned는 무조건 맨 위', () => {
    const pin = task({ title: '고정', pinned: true, importance: 1 });
    expect(sortByPriority([학회비, pin], NOW)[0]?.title).toBe('고정');
  });
});

describe('부스트 · 설정', () => {
  it('spent_min > 0 이면 +5', () => {
    const a = priorityScore(발표자료, NOW).score;
    const b = priorityScore({ ...발표자료, spent_min: 1 }, NOW).score;
    // 진행분만큼 남은 작업량이 줄어 여유가 늘므로 U는 약간 내려가지만 부스트가 더 크다
    expect(b).toBeGreaterThan(a);
  });

  it('반감 상수를 24h로 줄이면 임박도가 전반적으로 내려간다', () => {
    const cfg = { ...DEFAULT_SCORE_CONFIG, halfLifeHours: 24 };
    expect(priorityScore(운영체제, NOW, cfg).urgency).toBeLessThan(
      priorityScore(운영체제, NOW).urgency,
    );
  });

  it('U 곡선 기준점 (명세 4장)', () => {
    const at = (slack: number) => 100 / (1 + slack / 48);
    expect(at(0)).toBeCloseTo(100, 1);
    expect(at(12)).toBeCloseTo(80, 1);
    expect(at(24)).toBeCloseTo(66.7, 1);
    expect(at(48)).toBeCloseTo(50, 1);
    expect(at(168)).toBeCloseTo(22.2, 1);
  });

  it('등급 경계', () => {
    expect(gradeOf(90)).toBe('now');
    expect(gradeOf(89.9)).toBe('today');
    expect(gradeOf(70)).toBe('today');
    expect(gradeOf(69.9)).toBe('week');
    expect(gradeOf(40)).toBe('week');
    expect(gradeOf(39.9)).toBe('later');
  });
});

import type { Task } from './types';

/**
 * 설계 명세 4장 — 우선순위 점수.
 *
 *   slack = (due_at − now) − (estimate_min − spent_min)     // 시간 단위
 *   U     = 100 / (1 + max(slack, 0) / HALF_LIFE_H)         // 마감 임박도 0~100
 *   I     = (importance − 1) × 25                           // 1~5 → 0~100
 *   score = W_URGENT × U + W_IMPORTANT × I + boosts
 *
 * 이 함수는 웹·앱·위젯 세 곳이 공유한다. 세 곳에 각각 구현하면 정렬이 어긋난다.
 */

export interface ScoreConfig {
  /** 반감 상수. "며칠 앞부터 급해 보이는가". 설정에서 24~96h */
  halfLifeHours: number;
  /** 급함 가중치 (급함↔중요 슬라이더 하나로 조절) */
  weightUrgent: number;
  weightImportant: number;
  boosts: {
    overdue: number;
    kindDay: number;
    started: number;
    /** 선행 미완료 (v2) */
    blockedByIncomplete: number;
  };
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  halfLifeHours: 48,
  weightUrgent: 0.6,
  weightImportant: 0.4,
  boosts: { overdue: 30, kindDay: 10, started: 5, blockedByIncomplete: -20 },
};

/** pinned는 무조건 맨 위. 유한한 수로 두어야 정렬·직렬화가 깨지지 않는다. */
export const PINNED_SCORE = 1e6;

export type Grade = 'now' | 'today' | 'week' | 'later';

export interface ScoreBreakdown {
  score: number;
  /** 여유(시간). due_at이 없으면 null */
  slackHours: number | null;
  urgency: number;
  importance: number;
  boost: number;
  grade: Grade;
  /** 화면 우측 "점수 분해" 패널에 그대로 쓰는 설명 줄 */
  reasons: string[];
}

const H = 3_600_000;

/**
 * `kind=day`는 마감이 없지만 암묵 마감이 그날 23:59다 (2장).
 * 로컬 날짜 문자열을 그대로 Date로 넘기면 UTC로 해석되므로 직접 조립한다.
 */
function effectiveDueAt(task: Task): Date | null {
  if (task.due_at) return new Date(task.due_at);
  if (task.kind === 'day' && task.day_of) {
    const [y, m, d] = task.day_of.split('-').map(Number);
    return new Date(y as number, (m as number) - 1, d as number, 23, 59, 0, 0);
  }
  return null;
}

export function priorityScore(
  task: Task,
  now: Date = new Date(),
  cfg: ScoreConfig = DEFAULT_SCORE_CONFIG,
): ScoreBreakdown {
  const reasons: string[] = [];

  // someday는 정렬에서 제외한다 (2장). AI 초안이 여기로 들어오므로
  // "확정 전에는 점수에 넣지 않는다"(3.7.2)가 별도 장치 없이 성립한다.
  if (task.kind === 'someday' || task.status === 'done' || task.deleted_at) {
    return {
      score: Number.NEGATIVE_INFINITY,
      slackHours: null,
      urgency: 0,
      importance: 0,
      boost: 0,
      grade: 'later',
      reasons: [task.kind === 'someday' ? '인박스 — 정렬 제외' : '완료/삭제됨'],
    };
  }

  if (task.pinned) {
    return {
      score: PINNED_SCORE,
      slackHours: null,
      urgency: 100,
      importance: 100,
      boost: 0,
      grade: 'now',
      reasons: ['고정됨'],
    };
  }

  const due = effectiveDueAt(task);
  const remainingWork = Math.max(task.estimate_min - task.spent_min, 0) / 60;

  let slackHours: number | null = null;
  let urgency: number;

  if (due === null) {
    // 마감도 날짜도 없는 deadline Task는 입력 단계에서 막히지만, 방어적으로 0으로 둔다.
    urgency = 0;
    reasons.push('마감 없음 — 임박도 0');
  } else {
    slackHours = (due.getTime() - now.getTime()) / H - remainingWork;
    urgency = 100 / (1 + Math.max(slackHours, 0) / cfg.halfLifeHours);
    reasons.push(
      slackHours < 0
        ? `여유 ${slackHours.toFixed(1)}h — 이미 늦음`
        : `여유 ${slackHours.toFixed(1)}h → 임박도 ${urgency.toFixed(1)}`,
    );
  }

  const importance = (task.importance - 1) * 25;
  reasons.push(`중요도 ${task.importance} → ${importance}`);

  let boost = 0;
  if (due !== null && due.getTime() < now.getTime()) {
    boost += cfg.boosts.overdue;
    reasons.push(`마감 지남 +${cfg.boosts.overdue}`);
  }
  if (task.kind === 'day') {
    boost += cfg.boosts.kindDay;
    reasons.push(`오늘 할 일 +${cfg.boosts.kindDay}`);
  }
  if (task.spent_min > 0) {
    boost += cfg.boosts.started;
    reasons.push(`이미 시작함 +${cfg.boosts.started}`);
  }

  const score = cfg.weightUrgent * urgency + cfg.weightImportant * importance + boost;
  return { score, slackHours, urgency, importance, boost, grade: gradeOf(score), reasons };
}

/** 90+ 지금당장 / 70–89 오늘안에 / 40–69 이번주 / <40 여유 */
export function gradeOf(score: number): Grade {
  if (score >= 90) return 'now';
  if (score >= 70) return 'today';
  if (score >= 40) return 'week';
  return 'later';
}

export const GRADE_LABEL: Record<Grade, string> = {
  now: '지금당장',
  today: '오늘안에',
  week: '이번주',
  later: '여유',
};

/** 등급색 — 리스트 좌측 스트라이프 / 간트 테두리 / 위젯 점 */
export const GRADE_COLOR: Record<Grade, string> = {
  now: '#e5484d',
  today: '#f76b15',
  week: '#3e63dd',
  later: '#8b8d98',
};

/** 급한 순 정렬. 동점이면 마감 이른 순 → 수동 정렬 순. */
export function sortByPriority(tasks: Task[], now: Date = new Date(), cfg?: ScoreConfig): Task[] {
  const scored = tasks.map((t) => ({ t, s: priorityScore(t, now, cfg) }));
  scored.sort((a, b) => {
    if (b.s.score !== a.s.score) return b.s.score - a.s.score;
    const da = a.t.due_at ? Date.parse(a.t.due_at) : Number.POSITIVE_INFINITY;
    const db = b.t.due_at ? Date.parse(b.t.due_at) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.t.sort_order - b.t.sort_order;
  });
  return scored.map((x) => x.t);
}

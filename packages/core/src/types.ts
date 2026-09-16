import { z } from 'zod';

/**
 * 설계 명세 5장 — 데이터 모델.
 * 이 파일이 웹·앱·위젯이 공유하는 유일한 진실이다.
 * Postgres / 로컬 SQLite / Dexie 스키마는 전부 여기서 파생된다.
 *
 * 시각은 전부 UTC ISO 문자열(`timestamptz`)로 저장한다. 예외는 `day_of` 하나 —
 * 로컬 날짜(YYYY-MM-DD)다. UTC로 저장하면 자정 근처에서 오늘 할 일이 어제로 밀린다. (7장)
 */

export const TaskKind = z.enum(['day', 'deadline', 'someday']);
export type TaskKind = z.infer<typeof TaskKind>;

export const TaskStatus = z.enum(['todo', 'doing', 'done']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskSource = z.enum(['manual', 'quickadd', 'ai', 'import']);
export type TaskSource = z.infer<typeof TaskSource>;

export const BlockSource = z.enum(['manual', 'drag', 'timer', 'import']);
export type BlockSource = z.infer<typeof BlockSource>;

/**
 * 예상 소요시간의 경계. 폼의 직접 입력과 AI 응답 검증이 같은 값을 써야 한다 —
 * 한쪽만 느슨하면 거기로 이상한 값이 들어온다 (부록 A.6).
 */
export const EST_INPUT_MIN = 5;
export const EST_INPUT_MAX = 60 * 24; // 하루. 그보다 길면 할 일을 쪼개는 게 맞다
export const EST_MAX_MIN = 60 * 24 * 30; // 저장 한계 (import 등으로 들어온 값까지 허용)

/** 직접 입력값을 경계 안으로 맞춘다. 15분 배수로 강제하지는 않는다 — 40분도 쓸 수 있어야 한다. */
export function clampEstimate(min: number): number {
  if (!Number.isFinite(min)) return 60;
  return Math.min(EST_INPUT_MAX, Math.max(EST_INPUT_MIN, Math.round(min)));
}

const iso = z.string().datetime({ offset: true });
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const TaskSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  title: z.string().min(1).max(500),
  notes: z.string().max(20000).nullable().default(null),

  kind: TaskKind,
  status: TaskStatus.default('todo'),

  day_of: localDate.nullable().default(null),
  start_at: iso.nullable().default(null),
  due_at: iso.nullable().default(null),

  estimate_min: z.number().int().min(0).max(EST_MAX_MIN).default(60),
  spent_min: z.number().int().min(0).default(0),
  importance: z.number().int().min(1).max(5).default(3),
  progress: z.number().min(0).max(1).default(0),
  pinned: z.boolean().default(false),

  parent_id: z.string().nullable().default(null),
  rrule: z.string().nullable().default(null),
  sort_order: z.number().default(0),
  score: z.number().nullable().default(null),

  /** 3.7 — AI 생성분을 구분·일괄 정리하려면 필수 */
  source: TaskSource.default('manual'),
  /** 3.7.2 — AI가 추정한 소요시간이면 true. 확정 전에는 점수 정렬에서 뺀다 */
  estimate_is_ai: z.boolean().default(false),

  /** v2 잠금 항목 예약 (부록 A.2). M1에서는 항상 false/null */
  is_locked: z.boolean().default(false),
  enc_blob: z.instanceof(Uint8Array).nullable().default(null),

  created_at: iso,
  updated_at: iso,
  completed_at: iso.nullable().default(null),
  deleted_at: iso.nullable().default(null),
  rev: z.number().int().default(0),
});
export type Task = z.infer<typeof TaskSchema>;

export const BlockSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    task_id: z.string().nullable().default(null),
    /** task_id가 NULL일 때만 쓴다 (수업·약속 같은 순수 일정) */
    title: z.string().max(500).nullable().default(null),
    start_at: iso,
    end_at: iso,
    is_all_day: z.boolean().default(false),
    source: BlockSource.default('manual'),
    deleted_at: iso.nullable().default(null),
    rev: z.number().int().default(0),
  })
  .refine((b) => new Date(b.end_at) > new Date(b.start_at), {
    message: 'end_at must be after start_at',
    path: ['end_at'],
  })
  .refine((b) => b.task_id !== null || (b.title !== null && b.title.length > 0), {
    message: 'task_id가 없는 Block은 title이 필요하다',
    path: ['title'],
  });
export type Block = z.infer<typeof BlockSchema>;

export const TagSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sort_order: z.number().default(0),
  deleted_at: iso.nullable().default(null),
  rev: z.number().int().default(0),
});
export type Tag = z.infer<typeof TagSchema>;

export interface TaskTag {
  task_id: string;
  tag_id: string;
}

/** AI 응답 검증용 (3.7 / 11.1 — Zod를 AI 응답 검증에도 그대로 쓴다) */
export const AiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  estimate_min: z.number().int().min(EST_INPUT_MIN).max(EST_INPUT_MAX).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000).optional(),
});
export const AiBreakdownSchema = z.object({
  goal: z.string().min(1),
  drafts: z.array(AiDraftSchema).min(1).max(20),
});
export type AiDraft = z.infer<typeof AiDraftSchema>;

/**
 * 고정 일정 (3.8) — 수업·알바처럼 매주 같은 자리에 있는 것.
 *
 * Block으로 저장하지 않는다. 한 학기면 15주 × 주 3회 = 45행이고, 시간이 한 칸 바뀌면
 * 그 45행을 전부 고쳐야 한다. 규칙으로 두고 화면·배치 계산에서 그때그때 펼친다
 * (expandRoutines). 펼쳐진 것은 저장되지 않는 가상 Block이다.
 */
export const RoutineSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string().min(1).max(100),
  /** 0=월 … 6=일 */
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  /** 자정부터의 분 */
  start_min: z.number().int().min(0).max(1439),
  end_min: z.number().int().min(1).max(1440),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** 학기처럼 기간이 있는 경우. null이면 무기한 */
  active_from: localDate.nullable().default(null),
  active_to: localDate.nullable().default(null),
  deleted_at: iso.nullable().default(null),
  rev: z.number().int().default(0),
});
export type Routine = z.infer<typeof RoutineSchema>;

/**
 * 수면 패턴 (3.8). 평일과 주말 둘로 받는다 — 요일별 7줄은 정확하지만 아무도 안 채운다.
 *
 * 분은 자정 기준. start > end면 자정을 넘긴다 (01:00 취침 → 60, 08:00 기상 → 480).
 * 어느 쪽 규칙을 쓸지는 **기상하는 날**의 요일로 정한다 — "주말엔 늦게 자고 늦게 일어난다"가
 * 금요일 밤을 말하는 것이기 때문이다.
 */
export const SleepPatternSchema = z.object({
  weekdayStart: z.number().int().min(0).max(1439).default(1 * 60),
  weekdayEnd: z.number().int().min(0).max(1439).default(8 * 60),
  weekendStart: z.number().int().min(0).max(1439).default(2 * 60),
  weekendEnd: z.number().int().min(0).max(1439).default(10 * 60),
});
export type SleepPattern = z.infer<typeof SleepPatternSchema>;

/** 사용자 설정 한 줄. 12장 설정 탭의 가중치 슬라이더도 여기 산다 */
export const SettingsSchema = z.object({
  user_id: z.string(),
  sleep: SleepPatternSchema,
  /** 4장 — 급함↔중요 슬라이더와 반감 상수 */
  weight_urgent: z.number().min(0).max(1).default(0.6),
  half_life_hours: z.number().min(6).max(240).default(48),
  /** 3.8 자동 배치 — 맞닿는 자리마다 두는 여유(분). 수업 직후 바로 시작할 수는 없다 */
  gap_min: z.number().int().min(0).max(60).default(10),
  updated_at: iso,
  rev: z.number().int().default(0),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SLEEP: SleepPattern = {
  weekdayStart: 60,
  weekdayEnd: 480,
  weekendStart: 120,
  weekendEnd: 600,
};

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

  estimate_min: z.number().int().min(0).max(60 * 24 * 30).default(60),
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
  estimate_min: z.number().int().min(5).max(60 * 24).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000).optional(),
});
export const AiBreakdownSchema = z.object({
  goal: z.string().min(1),
  drafts: z.array(AiDraftSchema).min(1).max(20),
});
export type AiDraft = z.infer<typeof AiDraftSchema>;

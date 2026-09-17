import type { Block, Routine, RoutineCheck, Settings, Tag, Task } from './types';

/**
 * 8장 "세 번째 길" — 백엔드 결정을 미루는 경계.
 *
 *   LocalTaskRepo    → M1 (Dexie / SQLite)
 *   SupabaseTaskRepo → M2 선택 A
 *   RestTaskRepo     → M2 선택 B
 *
 * 10.1 — `user_id`는 여기서 강제 주입한다. 화면 코드가 user_id 조건을 직접 쓰는
 * 순간 다섯 명이 다섯 번 실수한다. 이 파일만 맞으면 된다.
 */

export interface TaskFilter {
  kind?: Task['kind'] | Task['kind'][];
  status?: Task['status'] | Task['status'][];
  tagIds?: string[];
  /** 이 날짜에 귀속된 day Task */
  dayOf?: string;
  /** 마감이 이 범위 안 */
  dueFrom?: string;
  dueTo?: string;
  includeDeleted?: boolean;
  search?: string;
}

export interface BlockRange {
  /** ISO. 7장 — GET /blocks는 from/to 필수 */
  from: string;
  to: string;
}

export interface TaskRepo {
  list(filter?: TaskFilter): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  /** 없으면 삽입, 있으면 갱신. 멱등이어야 한다 (아웃박스 재시도) */
  upsert(task: Task): Promise<Task>;
  upsertMany(tasks: Task[]): Promise<void>;
  /** 툼스톤. 물리 삭제하지 않는다 */
  remove(id: string): Promise<void>;
  syncSince(rev: number): Promise<{ tasks: Task[]; rev: number }>;
}

export interface BlockRepo {
  list(range: BlockRange): Promise<Block[]>;
  listByTask(taskId: string): Promise<Block[]>;
  upsert(block: Block): Promise<Block>;
  remove(id: string): Promise<void>;
}

export interface TagRepo {
  list(): Promise<Tag[]>;
  /**
   * 이름으로 찾는다 — **툼스톤된 것까지** 본다.
   * 삭제가 논리 삭제라 지운 태그가 UNIQUE(user_id, name)을 계속 붙들고 있다.
   * 이걸 모르면 "지웠던 이름을 다시 만들면 DB가 막는" 상태가 된다.
   */
  findByName(name: string): Promise<Tag | null>;
  upsert(tag: Tag): Promise<Tag>;
  remove(id: string): Promise<void>;
  setTaskTags(taskId: string, tagIds: string[]): Promise<void>;
  tagsOf(taskId: string): Promise<Tag[]>;
}

/**
 * 고정 일정 (3.8). 주 단위 규칙이므로 범위 조회가 없다 — 전부 읽어서 그때그때 펼친다
 * (core/schedule.ts expandRoutines). 한 사람이 가질 규칙은 많아야 수십 개다.
 */
export interface RoutineRepo {
  list(): Promise<Routine[]>;
  upsert(routine: Routine): Promise<Routine>;
  /** 툼스톤. 지운 수업이 지난 주 화면에서 사라지면 기록이 틀어진다 */
  remove(id: string): Promise<void>;
}

/** 고정 일정을 그 날 했는지. 키가 `${routine_id}:${day}`라 토글이 멱등이다 */
export interface RoutineCheckRepo {
  /** 로컬 날짜 문자열 범위 (양끝 포함) */
  listRange(from: string, to: string): Promise<RoutineCheck[]>;
  /** 없으면 체크, 있으면 해제. 새 상태를 돌려준다 */
  toggle(routineId: string, day: string): Promise<RoutineCheck>;
}

/** 사용자당 한 행. 없으면 null — 호출하는 쪽이 기본값(DEFAULT_SLEEP)을 쓴다 */
export interface SettingsRepo {
  get(): Promise<Settings | null>;
  save(settings: Settings): Promise<Settings>;
}

export interface Repos {
  tasks: TaskRepo;
  blocks: BlockRepo;
  tags: TagRepo;
  routines: RoutineRepo;
  routineChecks: RoutineCheckRepo;
  settings: SettingsRepo;
}

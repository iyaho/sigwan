import type { Block, Tag, Task } from './types';

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
  upsert(tag: Tag): Promise<Tag>;
  remove(id: string): Promise<void>;
  setTaskTags(taskId: string, tagIds: string[]): Promise<void>;
  tagsOf(taskId: string): Promise<Tag[]>;
}

export interface Repos {
  tasks: TaskRepo;
  blocks: BlockRepo;
  tags: TagRepo;
}

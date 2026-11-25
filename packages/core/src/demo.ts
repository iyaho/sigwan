import type { MockData } from './mock';
import { MOCK_EVENT_TITLES, MOCK_TAG_DEFS } from './mock';
import type { Block, Tag, Task, TaskTag } from './types';

/**
 * 예시 데이터 — 처음 열면 보여 주기만 하고, 직접 뭔가를 등록하는 순간 지운다. **서버로는 올리지 않는다.**
 *
 * 어느 행이 예시인지는 기기의 meta에 id 목록으로 적어 둔다. 예시 행을 고쳐도(체크 등) 예시다.
 */
export interface DemoIds {
  tasks: string[];
  blocks: string[];
  tags: string[];
}

export const DEMO_IDS_KEY = 'demo_ids';
/** 'shown' = 지금 보이는 중, 'cleared' = 지웠다(다시 넣지 않는다). 없으면 아직 판단 전 */
export const DEMO_STATE_KEY = 'demo_state';

export const demoIdsOf = (m: MockData): DemoIds => ({
  tasks: m.tasks.map((t) => t.id),
  blocks: m.blocks.map((b) => b.id),
  tags: m.tags.map((t) => t.id),
});

/** 이만큼 이상의 할 일이 같은 생성 시각을 가지면 예시 묶음이다 (예시는 53개, 사람이 한 ms에 20개를 만들 일은 없다) */
const SEED_BATCH_MIN = 20;

/**
 * 예시 id를 적어 두기 전에 깔린 기기 — 예시 행을 찾아낸다.
 *
 *  - 할 일: 예시는 전부 생성 시각이 같다(makeMockData의 createdAt). 고쳐도 created_at은 그대로다
 *  - 블록: 예시 할 일에 딸렸거나, 할 일 없이 예시 일정 제목을 단 것
 *  - 태그: 예시 태그 이름이면서 **사람이 만든 할 일에는 안 붙은 것** — 예시 태그를 자기 할 일에 쓰고 있으면 남긴다
 */
export function detectLegacyDemo(d: { tasks: Task[]; blocks: Block[]; tags: Tag[]; taskTags: TaskTag[] }): DemoIds {
  const byCreated = new Map<string, Task[]>();
  for (const t of d.tasks) {
    const arr = byCreated.get(t.created_at);
    if (arr) arr.push(t);
    else byCreated.set(t.created_at, [t]);
  }
  let batch: Task[] = [];
  for (const arr of byCreated.values()) if (arr.length >= SEED_BATCH_MIN && arr.length > batch.length) batch = arr;
  if (!batch.length) return { tasks: [], blocks: [], tags: [] };

  const taskIds = new Set(batch.map((t) => t.id));
  const eventTitles = new Set(MOCK_EVENT_TITLES);
  const blocks = d.blocks.filter(
    (b) => (b.task_id && taskIds.has(b.task_id)) || (!b.task_id && b.title !== null && eventTitles.has(b.title)),
  );

  const demoTagNames = new Set(MOCK_TAG_DEFS.map(([name]) => name));
  const usedByReal = new Set(d.taskTags.filter((l) => !taskIds.has(l.task_id)).map((l) => l.tag_id));
  const tags = d.tags.filter((t) => demoTagNames.has(t.name) && !usedByReal.has(t.id));

  return { tasks: [...taskIds], blocks: blocks.map((b) => b.id), tags: tags.map((t) => t.id) };
}

/**
 * 실제로 지울 행. 예시 할 일에 사람이 붙인 블록·하위작업도 같이 간다 — 남기면 주인 없는 블록이 된다.
 * 예시 태그는 그 사이 사람이 만든 할 일에 붙였으면 남긴다.
 */
export function demoRowsToDelete(ids: DemoIds, d: { tasks: Task[]; blocks: Block[]; taskTags: TaskTag[] }): DemoIds {
  const tasks = new Set(ids.tasks);
  for (const t of d.tasks) if (t.parent_id && tasks.has(t.parent_id)) tasks.add(t.id);
  const blocks = new Set(ids.blocks);
  for (const b of d.blocks) if (b.task_id && tasks.has(b.task_id)) blocks.add(b.id);
  const usedByReal = new Set(d.taskTags.filter((l) => !tasks.has(l.task_id)).map((l) => l.tag_id));
  return { tasks: [...tasks], blocks: [...blocks], tags: ids.tags.filter((id) => !usedByReal.has(id)) };
}

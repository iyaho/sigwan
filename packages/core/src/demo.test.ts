import { describe, expect, it } from 'vitest';
import { demoIdsOf, demoRowsToDelete, detectLegacyDemo } from './demo';
import { makeMockData } from './mock';
import type { Block, Tag, Task } from './types';

const NOW = new Date('2026-11-25T10:00:00+09:00');

describe('detectLegacyDemo — 예시 id를 적어 두기 전에 깔린 기기', () => {
  const m = makeMockData(NOW);
  const real: Task = { ...m.tasks[0]!, id: 'mine', title: '내 과제', created_at: '2026-11-20T03:00:00.000Z' };
  const realBlock: Block = { ...m.blocks[0]!, id: 'mine-b', task_id: 'mine' };
  const myTag: Tag = { ...m.tags[0]!, id: 'my-tag', name: '동아리' };

  it('예시 묶음(같은 생성 시각)을 찾고, 사람이 만든 것은 뺀다', () => {
    const d = detectLegacyDemo({
      tasks: [...m.tasks, real],
      blocks: [...m.blocks, realBlock],
      tags: [...m.tags, myTag],
      taskTags: m.taskTags,
    });
    expect(new Set(d.tasks)).toEqual(new Set(m.tasks.map((t) => t.id)));
    expect(d.tasks).not.toContain('mine');
    expect(d.blocks).not.toContain('mine-b');
    expect(new Set(d.blocks)).toEqual(new Set(m.blocks.map((b) => b.id)));
    expect(new Set(d.tags)).toEqual(new Set(m.tags.map((t) => t.id)));
  });

  it('예시 태그를 내 할 일에 붙여 쓰고 있으면 그 태그는 남긴다', () => {
    const used = m.tags[2]!;
    const d = detectLegacyDemo({
      tasks: [...m.tasks, real],
      blocks: m.blocks,
      tags: m.tags,
      taskTags: [...m.taskTags, { task_id: 'mine', tag_id: used.id }],
    });
    expect(d.tags).not.toContain(used.id);
    expect(d.tags).toHaveLength(m.tags.length - 1);
  });

  it('예시가 없는 기기(이미 직접 쓴 것뿐)는 아무것도 고르지 않는다', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => ({ ...real, id: `r${i}`, created_at: `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }));
    expect(detectLegacyDemo({ tasks, blocks: [], tags: m.tags, taskTags: [] })).toEqual({ tasks: [], blocks: [], tags: [] });
  });
});

describe('demoRowsToDelete', () => {
  const m = makeMockData(NOW);
  const ids = demoIdsOf(m);

  it('예시 할 일에 사람이 붙인 블록·하위작업도 같이 지운다', () => {
    const parent = m.tasks[0]!;
    const child: Task = { ...parent, id: 'my-sub', parent_id: parent.id, created_at: '2026-11-25T00:00:00.000Z' };
    const block: Block = { ...m.blocks[0]!, id: 'my-block', task_id: parent.id };
    const del = demoRowsToDelete(ids, { tasks: [...m.tasks, child], blocks: [...m.blocks, block], taskTags: m.taskTags });
    expect(del.tasks).toContain('my-sub');
    expect(del.blocks).toContain('my-block');
  });

  it('그 사이 내 할 일에 붙인 예시 태그는 남긴다', () => {
    const tag = m.tags[1]!;
    const del = demoRowsToDelete(ids, { tasks: m.tasks, blocks: m.blocks, taskTags: [...m.taskTags, { task_id: 'mine', tag_id: tag.id }] });
    expect(del.tags).not.toContain(tag.id);
  });
});

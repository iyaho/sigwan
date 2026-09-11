import type { Block, Tag, Task, ZoomLevel } from '@sigwan/core';
import { newId } from '@sigwan/core';
import { create } from 'zustand';
import { repos, seedIfEmpty } from './lib/db';

export type ViewKey = 'today' | 'next7' | 'inbox' | 'done' | 'all';

interface State {
  ready: boolean;
  tasks: Task[];
  blocks: Block[];
  tags: Tag[];
  taskTags: Record<string, string[]>;

  view: ViewKey;
  selectedTagIds: string[];
  selectedTaskId: string | null;
  zoom: ZoomLevel;
  /** 타임라인 왼쪽 끝 시각 */
  origin: Date;
  /** 스냅 해제 (Alt) */
  snapDisabled: boolean;

  load: () => Promise<void>;
  setView: (v: ViewKey) => void;
  toggleTag: (id: string) => void;
  select: (id: string | null) => void;
  setZoom: (z: ZoomLevel) => void;
  setOrigin: (d: Date) => void;
  setSnapDisabled: (b: boolean) => void;

  saveTask: (t: Task) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  saveBlock: (b: Block) => Promise<void>;
  removeBlock: (id: string) => Promise<void>;
  /** 인박스 Task를 타임라인에 떨어뜨림 → Block 생성 (3.2) */
  scheduleTask: (taskId: string, startAt: Date) => Promise<void>;
}

/** StrictMode가 effect를 두 번 돌린다. 목 데이터 53건 × tagsOf 쿼리를 두 벌 돌릴 이유가 없다. */
let loading: Promise<void> | null = null;

function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  tasks: [],
  blocks: [],
  tags: [],
  taskTags: {},

  view: 'today',
  selectedTagIds: [],
  selectedTaskId: null,
  zoom: 'day',
  origin: startOfDay(),
  snapDisabled: false,

  async load() {
    if (loading) return loading;
    loading = (async () => {
    await seedIfEmpty();
    const [tasks, tags] = await Promise.all([repos.tasks.list(), repos.tags.list()]);
    const o = get().origin;
    const blocks = await repos.blocks.list({
      from: new Date(o.getTime() - 30 * 864e5).toISOString(),
      to: new Date(o.getTime() + 60 * 864e5).toISOString(),
    });
    const taskTags: Record<string, string[]> = {};
    for (const t of tasks) taskTags[t.id] = (await repos.tags.tagsOf(t.id)).map((x) => x.id);
    set({ tasks, blocks, tags, taskTags, ready: true });
    })();
    return loading;
  },

  setView: (view) => set({ view }),
  toggleTag: (id) =>
    set((s) => ({
      selectedTagIds: s.selectedTagIds.includes(id)
        ? s.selectedTagIds.filter((x) => x !== id)
        : [...s.selectedTagIds, id],
    })),
  select: (selectedTaskId) => set({ selectedTaskId }),
  setZoom: (zoom) => set({ zoom }),
  setOrigin: (origin) => set({ origin }),
  setSnapDisabled: (snapDisabled) => set({ snapDisabled }),

  async saveTask(t) {
    const saved = await repos.tasks.upsert(t);
    set((s) => ({ tasks: s.tasks.map((x) => (x.id === saved.id ? saved : x)) }));
  },

  async toggleDone(id) {
    const t = get().tasks.find((x) => x.id === id);
    if (!t) return;
    const done = t.status !== 'done';
    await get().saveTask({
      ...t,
      status: done ? 'done' : 'todo',
      completed_at: done ? new Date().toISOString() : null,
      progress: done ? 1 : 0,
    });
  },

  async saveBlock(b) {
    const saved = await repos.blocks.upsert(b);
    set((s) => ({
      blocks: s.blocks.some((x) => x.id === saved.id)
        ? s.blocks.map((x) => (x.id === saved.id ? saved : x))
        : [...s.blocks, saved],
    }));
  },

  async removeBlock(id) {
    await repos.blocks.remove(id);
    set((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) }));
  },

  async scheduleTask(taskId, startAt) {
    const t = get().tasks.find((x) => x.id === taskId);
    if (!t) return;
    await get().saveBlock({
      id: newId(),
      user_id: 'local-user',
      task_id: taskId,
      title: null,
      start_at: startAt.toISOString(),
      end_at: new Date(startAt.getTime() + Math.max(t.estimate_min, 15) * 60_000).toISOString(),
      is_all_day: false,
      source: 'drag',
      deleted_at: null,
      rev: 0,
    });
  },
}));

import type { Block, Tag, Task, ZoomLevel } from '@sigwan/core';
import { newId } from '@sigwan/core';
import { useLayout } from './lib/layout';
import { type ViewKey, filterByView, viewThatShows } from './lib/views';
import { create } from 'zustand';
import { repos, seedIfEmpty } from './lib/db';

export type { ViewKey };

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

  /** 3.3 추가 폼에서 호출. kind는 이미 입력에서 결정돼 들어온다. */
  addTask: (
    draft: Partial<Task> & { title: string },
    opts?: { tagIds?: string[]; scheduleNow?: boolean },
  ) => Promise<string>;

  /**
   * 간트 막대 → 그 할 일 보여주기.
   * 선택만 하면 인라인 모드에서 그 줄이 지금 목록에 없을 때 아무것도 안 보인다.
   * 그래서 보이는 목록으로 데려온 다음 선택한다.
   */
  revealTask: (taskId: string) => void;
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

  async addTask(draft, opts = {}) {
    const now = new Date().toISOString();
    const maxOrder = get().tasks.reduce((m, t) => Math.max(m, t.sort_order), 0);
    const task: Task = {
      id: newId(),
      user_id: 'local-user',
      title: draft.title.trim(),
      notes: draft.notes ?? null,
      kind: draft.kind ?? 'someday',
      status: 'todo',
      day_of: draft.day_of ?? null,
      start_at: draft.start_at ?? null,
      due_at: draft.due_at ?? null,
      estimate_min: draft.estimate_min ?? 60,
      spent_min: 0,
      importance: draft.importance ?? 3,
      progress: 0,
      pinned: false,
      parent_id: null,
      rrule: null,
      sort_order: maxOrder + 1000,
      score: null,
      source: 'manual',
      estimate_is_ai: false,
      is_locked: false,
      enc_blob: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      deleted_at: null,
      rev: 0,
    };
    const saved = await repos.tasks.upsert(task);
    const tagIds = opts.tagIds ?? [];
    if (tagIds.length) await repos.tags.setTaskTags(saved.id, tagIds);
    set((s) => ({
      tasks: [...s.tasks, saved],
      taskTags: { ...s.taskTags, [saved.id]: tagIds },
    }));
    if (opts.scheduleNow) {
      // 지금 시각을 15분 격자에 올려서 잡는다
      const n = new Date();
      n.setMinutes(Math.round(n.getMinutes() / 15) * 15, 0, 0);
      await get().scheduleTask(saved.id, n);
    }
    return saved.id;
  },

  revealTask(taskId) {
    const st = get();
    const t = st.tasks.find((x) => x.id === taskId);
    if (!t) return;

    // 지금 목록에 이미 보이면 뷰를 건드리지 않는다 — 남의 사이드바 선택을 함부로 바꾸지 않는다.
    const visible =
      filterByView(st.tasks, st.view).some((x) => x.id === taskId) &&
      (st.selectedTagIds.length === 0 ||
        (st.taskTags[taskId] ?? []).some((id) => st.selectedTagIds.includes(id)));

    if (visible) {
      set({ selectedTaskId: taskId });
      return;
    }
    set({ selectedTaskId: taskId, selectedTagIds: [], view: viewThatShows(t) });
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

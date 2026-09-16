import type { Block, FitResult, Tag, Task } from '@sigwan/core';
import { fitBlock, newId, parentUpdate, progressOf, remainingToSchedule } from '@sigwan/core';
import { create } from 'zustand';
import { repos } from './db/repos';

/**
 * 앱 상태. 웹 store와 같은 모양 — 액션이 저장과 상태 갱신을 같이 한다.
 * 화면은 repos를 직접 만지지 않는다.
 */

interface State {
  ready: boolean;
  tasks: Task[];
  blocks: Block[];
  tags: Tag[];
  taskTags: Record<string, string[]>;
  selectedTaskId: string | null;

  load: () => Promise<void>;
  select: (id: string | null) => void;
  saveTask: (t: Task) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  addTask: (
    draft: Partial<Task> & { title: string },
    opts?: { tagIds?: string[]; scheduleNow?: boolean },
  ) => Promise<string>;
  saveBlock: (b: Block) => Promise<void>;
  removeBlock: (id: string) => Promise<void>;
  /** 자동 배치. 실제로 잡힌 길이를 돌려준다 — 부족분을 화면에서 알려줘야 한다 (fit.ts) */
  scheduleTask: (taskId: string, startAt: Date) => Promise<FitResult | null>;
  setTaskTags: (taskId: string, tagIds: string[]) => Promise<void>;
}

let loading: Promise<void> | null = null;

export const useStore = create<State>((set, get) => ({
  ready: false,
  tasks: [],
  blocks: [],
  tags: [],
  taskTags: {},
  selectedTaskId: null,

  load() {
    if (loading) return loading;
    loading = (async () => {
      const now = Date.now();
      const [tasks, tags, blocks, taskTags] = await Promise.all([
        repos.tasks.list(),
        repos.tags.list(),
        repos.blocks.list({
          from: new Date(now - 30 * 864e5).toISOString(),
          to: new Date(now + 90 * 864e5).toISOString(),
        }),
        repos.tags.allLinks(),
      ]);
      set({ tasks, tags, blocks, taskTags, ready: true });
    })().finally(() => {
      loading = null;
    });
    return loading;
  },

  select: (selectedTaskId) => set({ selectedTaskId }),

  async saveTask(t) {
    const saved = await repos.tasks.upsert(t);
    set((s) => ({ tasks: s.tasks.map((x) => (x.id === saved.id ? saved : x)) }));
  },

  async toggleDone(id) {
    const t = get().tasks.find((x) => x.id === id);
    if (!t) return;
    const done = t.status !== 'done';
    const next: Task = {
      ...t,
      status: done ? 'done' : 'todo',
      completed_at: done ? new Date().toISOString() : null,
    };
    next.progress = progressOf(next, get().tasks);
    await get().saveTask(next);
    const pu = parentUpdate(next, get().tasks);
    if (pu) await get().saveTask(pu);
  },

  async removeTask(id) {
    const st = get();
    const kids = st.tasks.filter((t) => t.parent_id === id && !t.deleted_at);
    const gone = new Set([id, ...kids.map((k) => k.id)]);
    for (const tid of gone) await repos.tasks.remove(tid);
    for (const bk of st.blocks.filter((bk) => bk.task_id && gone.has(bk.task_id))) await repos.blocks.remove(bk.id);
    set((s) => ({
      tasks: s.tasks.filter((t) => !gone.has(t.id)),
      blocks: s.blocks.filter((bk) => !(bk.task_id && gone.has(bk.task_id))),
      selectedTaskId: s.selectedTaskId && gone.has(s.selectedTaskId) ? null : s.selectedTaskId,
    }));
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
    set((s) => ({ tasks: [...s.tasks, saved], taskTags: { ...s.taskTags, [saved.id]: tagIds } }));
    if (opts.scheduleNow) {
      const n = new Date();
      n.setMinutes(Math.round(n.getMinutes() / 15) * 15, 0, 0);
      await get().scheduleTask(saved.id, n);
    }
    return saved.id;
  },

  async saveBlock(bk) {
    const saved = await repos.blocks.upsert(bk);
    set((s) => ({
      blocks: s.blocks.some((x) => x.id === saved.id)
        ? s.blocks.map((x) => (x.id === saved.id ? saved : x))
        : [...s.blocks, saved],
    }));
  },

  async removeBlock(id) {
    await repos.blocks.remove(id);
    set((s) => ({ blocks: s.blocks.filter((bk) => bk.id !== id) }));
  },

  async scheduleTask(taskId, startAt) {
    const t = get().tasks.find((x) => x.id === taskId);
    if (!t) return null;

    // 블록 길이 = 예상 소요시간이 아니다. "이번에 얼마나 할 것인가"다 (fit.ts).
    // 20시간짜리를 통째로 넣으려 하면 어떤 규칙을 써도 이상해진다.
    const want = remainingToSchedule(t, get().blocks) || Math.max(t.estimate_min, 15);
    const fit = fitBlock({ start: startAt, wantMinutes: want, existing: get().blocks });
    if (fit.tooSmall) return fit; // 15분도 안 나오는 자리 — 만들지 않는다

    await get().saveBlock({
      id: newId(),
      user_id: 'local-user',
      task_id: taskId,
      title: null,
      start_at: fit.start.toISOString(),
      end_at: fit.end.toISOString(),
      is_all_day: false,
      source: 'drag',
      deleted_at: null,
      rev: 0,
    });
    return fit;
  },

  async setTaskTags(taskId, tagIds) {
    await repos.tags.setTaskTags(taskId, tagIds);
    set((s) => ({ taskTags: { ...s.taskTags, [taskId]: tagIds } }));
  },
}));

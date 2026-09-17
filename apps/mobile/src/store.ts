import type {
  AutoScheduleResult,
  Block,
  FitResult,
  Proposal,
  Routine,
  Settings,
  SleepPattern,
  Tag,
  Task,
} from '@sigwan/core';
import {
  addDays,
  autoSchedule,
  DEFAULT_GAP_MIN,
  DEFAULT_SLEEP,
  endOfWakingDay,
  fitBlock,
  newId,
  nowIso,
  parentUpdate,
  progressOf,
  proposalToBlock,
  remainingToSchedule,
  startOfDay,
  ymd,
} from '@sigwan/core';
import { create } from 'zustand';
import { repos } from './db/repos';

/**
 * 앱 상태. 웹 store와 같은 모양 — 액션이 저장과 상태 갱신을 같이 한다.
 * 화면은 repos를 직접 만지지 않는다.
 */

/** 오늘 = 지금부터 내일 기상 전까지 (core/endOfWakingDay), 7일 = 지금부터 이레 */
export type AutoRange = 'today' | 'week';

interface State {
  ready: boolean;
  /**
   * load()가 실패하면 여기 남는다.
   * 예전엔 그냥 rejected promise로 사라져서 로딩 화면이 영원히 떠 있었고,
   * 배경이 거의 흰색이라 "흰 화면에 아무것도 안 찍힘"으로 보였다. 원인을 못 찾는 상태 자체가 버그다.
   */
  error: string | null;
  tasks: Task[];
  blocks: Block[];
  tags: Tag[];
  taskTags: Record<string, string[]>;
  selectedTaskId: string | null;

  /** 3.8 — 규칙으로 저장하고 화면에서 펼친다 */
  routines: Routine[];
  /** 체크한 것만 담는다. 키는 core/checkKey */
  routineChecks: Record<string, true>;
  /** 없으면 기본값으로 시작하고 처음 저장할 때 행이 생긴다 */
  settings: Settings;
  /** 제안은 저장된 것이 아니다. 「적용」을 눌러야 Block이 된다 (3.8.3) */
  proposals: Proposal[];
  autoResult: AutoScheduleResult | null;
  autoRange: AutoRange;
  autoEdited: boolean;

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

  /** 3.4 태그 CRUD — 앱에 진입점이 없어 웹에서만 만들 수 있었다 */
  addTag: (name: string, color: string) => Promise<string | null>;
  updateTag: (id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>) => Promise<void>;
  removeTag: (id: string) => Promise<void>;

  saveSleep: (sleep: SleepPattern) => Promise<void>;
  setGapMin: (min: number) => Promise<void>;
  saveRoutine: (r: Routine) => Promise<void>;
  addRoutine: (draft: Omit<Routine, 'id' | 'user_id' | 'deleted_at' | 'rev'>) => Promise<string>;
  removeRoutine: (id: string) => Promise<void>;
  toggleRoutineCheck: (routineId: string, day: string) => Promise<void>;

  propose: (range?: AutoRange) => void;
  editProposal: (key: string, patch: { start?: Date; end?: Date }) => void;
  dropProposal: (key: string) => void;
  clearProposals: () => void;
  applyProposals: () => Promise<void>;
}

/** 아직 저장된 설정이 없을 때. 첫 저장에서 이 값이 그대로 행이 된다 */
function defaultSettings(): Settings {
  return {
    user_id: 'local-user',
    sleep: DEFAULT_SLEEP,
    weight_urgent: 0.6,
    half_life_hours: 48,
    gap_min: DEFAULT_GAP_MIN,
    updated_at: nowIso(),
    rev: 0,
  };
}

let loading: Promise<void> | null = null;

export const useStore = create<State>((set, get) => ({
  ready: false,
  error: null,
  tasks: [],
  blocks: [],
  tags: [],
  taskTags: {},
  selectedTaskId: null,
  routines: [],
  routineChecks: {},
  settings: defaultSettings(),
  proposals: [],
  autoResult: null,
  autoRange: 'week',
  autoEdited: false,

  load() {
    if (loading) return loading;
    set({ error: null });
    loading = (async () => {
      const now = Date.now();
      const [tasks, tags, blocks, taskTags, routines, settings, checkRows] = await Promise.all([
        repos.tasks.list(),
        repos.tags.list(),
        repos.blocks.list({
          from: new Date(now - 30 * 864e5).toISOString(),
          to: new Date(now + 90 * 864e5).toISOString(),
        }),
        repos.tags.allLinks(),
        repos.routines.list(),
        repos.settings.get(),
        repos.routineChecks.listRange(ymd(new Date(now - 30 * 864e5)), ymd(new Date(now + 90 * 864e5))),
      ]);
      const routineChecks: Record<string, true> = {};
      for (const c of checkRows) routineChecks[c.id] = true;
      set({
        tasks, tags, blocks, taskTags, routines, routineChecks,
        settings: settings ?? defaultSettings(),
        ready: true,
      });
    })()
      .catch((e: unknown) => {
        // 삼켜지면 영원한 로딩 화면이 된다. 화면에 띄우고 다시 시도할 수 있게 한다
        set({ error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ready: false });
      })
      .finally(() => {
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

  async addTag(name, color) {
    const clean = name.trim();
    if (!clean) return null;
    // UNIQUE(user_id, name) — 5장
    if (get().tags.some((x) => x.name === clean && !x.deleted_at)) return null;

    /**
     * 삭제가 툼스톤이라(7장) 지운 태그의 행이 그 이름을 계속 붙들고 있다.
     * 같은 이름으로 새 행을 넣으면 SQLite의 UNIQUE(user_id, name)가 막는다.
     * 그래서 지운 행이 있으면 **그 행을 되살린다** — 새로 만드는 대신.
     * 예전에 그 태그가 붙어 있던 할 일에는 다시 붙는다. 되살리는 것이니 그게 맞다.
     */
    const buried = await repos.tags.findByName(clean);
    if (buried) {
      const revived = await repos.tags.upsert({
        ...buried,
        color,
        deleted_at: null,
        sort_order: get().tags.length,
      });
      set((s) => ({ tags: [...s.tags.filter((x) => x.id !== revived.id), revived] }));
      return revived.id;
    }
    const tag = await repos.tags.upsert({
      id: newId(),
      user_id: 'local-user',
      name: clean,
      color,
      sort_order: get().tags.length,
      deleted_at: null,
      rev: 0,
    });
    set((s) => ({ tags: [...s.tags, tag] }));
    return tag.id;
  },

  async updateTag(id, patch) {
    const cur = get().tags.find((t) => t.id === id);
    if (!cur) return;
    let next = patch;
    if (patch.name !== undefined) {
      const clean = patch.name.trim();
      if (!clean) return;
      if (get().tags.some((x) => x.id !== id && x.name === clean && !x.deleted_at)) return;
      /**
       * 지운 태그가 그 이름을 붙들고 있으면 UNIQUE(user_id, name)에 막힌다.
       * 툼스톤을 물리 삭제하면 "지웠다"가 다른 기기에 전달되지 않으므로(7장),
       * 대신 그 행의 이름만 비켜준다. 어차피 지워진 행이라 이름은 의미가 없다.
       */
      const buried = await repos.tags.findByName(clean);
      if (buried && buried.id !== id) {
        await repos.tags.upsert({ ...buried, name: `${clean}#${buried.id.slice(0, 8)}` });
      }
      next = { ...patch, name: clean };
    }
    const saved = await repos.tags.upsert({ ...cur, ...next });
    set((s) => ({ tags: s.tags.map((t) => (t.id === id ? saved : t)) }));
  },

  async removeTag(id) {
    await repos.tags.remove(id); // 툼스톤 (7장)
    set((s) => {
      const taskTags: Record<string, string[]> = {};
      for (const [taskId, ids] of Object.entries(s.taskTags)) taskTags[taskId] = ids.filter((x) => x !== id);
      return { tags: s.tags.filter((t) => t.id !== id), taskTags };
    });
  },

  // ── 3.8 설정 ──────────────────────────────────────────────────────
  async saveSleep(sleep) {
    const saved = await repos.settings.save({ ...get().settings, sleep });
    set({ settings: saved });
  },

  async setGapMin(gap_min) {
    const saved = await repos.settings.save({ ...get().settings, gap_min });
    set({ settings: saved });
  },

  async saveRoutine(r) {
    const saved = await repos.routines.upsert(r);
    set((s) => ({
      routines: s.routines.some((x) => x.id === saved.id)
        ? s.routines.map((x) => (x.id === saved.id ? saved : x))
        : [...s.routines, saved],
    }));
  },

  async addRoutine(draft) {
    const r: Routine = { ...draft, id: newId(), user_id: 'local-user', deleted_at: null, rev: 0 };
    await get().saveRoutine(r);
    return r.id;
  },

  async removeRoutine(id) {
    await repos.routines.remove(id);
    set((s) => ({ routines: s.routines.filter((r) => r.id !== id) }));
  },

  async toggleRoutineCheck(routineId, day) {
    const row = await repos.routineChecks.toggle(routineId, day);
    set((s) => {
      const next = { ...s.routineChecks };
      if (row.deleted_at) delete next[row.id];
      else next[row.id] = true;
      return { routineChecks: next };
    });
  },

  // ── 3.8 자동 배치 ─────────────────────────────────────────────────
  propose(range) {
    const st = get();
    const r = range ?? st.autoRange;
    const now = new Date();
    const to = r === 'today' ? endOfWakingDay(st.settings.sleep, now) : addDays(startOfDay(now), 7);
    const res = autoSchedule({
      tasks: st.tasks,
      blocks: st.blocks,
      routines: st.routines,
      sleep: st.settings.sleep,
      from: now,
      to,
      now,
      gapMin: st.settings.gap_min,
    });
    set({ proposals: res.proposals, autoResult: res, autoRange: r, autoEdited: false });
  },

  editProposal(key, patch) {
    set((s) => ({
      autoEdited: true,
      proposals: s.proposals.map((p) => {
        if (p.key !== key) return p;
        const start = patch.start ?? new Date(p.start);
        const end = patch.end ?? new Date(start.getTime() + p.minutes * 60_000);
        return {
          ...p,
          start: start.toISOString(),
          end: end.toISOString(),
          minutes: Math.round((end.getTime() - start.getTime()) / 60_000),
        };
      }),
    }));
  },

  dropProposal(key) {
    set((s) => ({ proposals: s.proposals.filter((p) => p.key !== key), autoEdited: true }));
  },

  clearProposals() {
    set({ proposals: [], autoResult: null, autoEdited: false });
  },

  /** 여기서 처음으로 DB가 바뀐다 */
  async applyProposals() {
    for (const p of get().proposals) {
      await get().saveBlock(proposalToBlock(p, newId(), 'local-user'));
    }
    set({ proposals: [], autoResult: null, autoEdited: false });
  },
}));

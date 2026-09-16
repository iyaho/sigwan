import type { Block, FitResult, Routine, Settings, SleepPattern, Tag, Task, ZoomLevel } from '@sigwan/core';
import {
  DEFAULT_GAP_MIN,
  DEFAULT_SLEEP,
  FIT_LIMIT_LABEL,
  fitBlock,
  filterByView,
  newId,
  parentUpdate,
  progressOf,
  fitSummary,
  nowIso,
  remainingToSchedule,
  type ViewKey,
  viewThatShows,
} from '@sigwan/core';
import { useLayout } from './lib/layout';
import { create } from 'zustand';
import { repos, seedIfEmpty } from './lib/db';

export type { ViewKey };

interface State {
  ready: boolean;
  tasks: Task[];
  blocks: Block[];
  tags: Tag[];
  taskTags: Record<string, string[]>;
  /** 3.8 고정 일정 — 저장은 규칙으로, 화면에서 그때그때 펼친다 */
  routines: Routine[];
  /** 설정은 없을 수 있다. 없으면 기본값으로 시작하고 처음 저장할 때 행이 생긴다 */
  settings: Settings;

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

  /** 3.8 설정 — 수면 네 값과 자동 배치 간격 */
  saveSleep: (sleep: SleepPattern) => Promise<void>;
  setGapMin: (min: number) => Promise<void>;
  saveRoutine: (r: Routine) => Promise<void>;
  addRoutine: (draft: Omit<Routine, 'id' | 'user_id' | 'deleted_at' | 'rev'>) => Promise<string>;
  removeRoutine: (id: string) => Promise<void>;

  saveTask: (t: Task) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  /** 툼스톤. 하위작업도 같이 지운다 — 부모 없는 자식은 화면에서 갈 곳이 없다 */
  removeTask: (id: string) => Promise<void>;
  /** `/` 검색 (12장). 제목·메모 부분 일치 */
  search: string;
  setSearch: (q: string) => void;
  saveBlock: (b: Block) => Promise<void>;
  removeBlock: (id: string) => Promise<void>;
  /** 인박스 Task를 타임라인에 떨어뜨림 → Block 생성 (3.2) */
  /** 짧게 떴다 사라지는 알림. 자동 배치가 예상보다 짧게 잡혔을 때 말해준다 */
  notice: string | null;
  setNotice: (m: string | null) => void;
  /** 자동 배치. 실제로 잡힌 길이를 돌려준다 — 부족분을 화면에서 알려줘야 한다 (fit.ts) */
  scheduleTask: (taskId: string, startAt: Date) => Promise<FitResult | null>;

  /** 태그 CRUD (3.4). 계층 없음 — 필요하면 이름에 슬래시를 쓴다. */
  addTag: (name: string, color: string) => Promise<string | null>;
  updateTag: (id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>) => Promise<void>;
  removeTag: (id: string) => Promise<void>;
  setTaskTags: (taskId: string, tagIds: string[]) => Promise<void>;

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

function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  tasks: [],
  blocks: [],
  tags: [],
  taskTags: {},
  routines: [],
  settings: defaultSettings(),

  view: 'today',
  search: '',
  selectedTagIds: [],
  selectedTaskId: null,
  notice: null,
  zoom: 'day',
  origin: startOfDay(),
  snapDisabled: false,

  async load() {
    if (loading) return loading;
    loading = (async () => {
    await seedIfEmpty();
    const [tasks, tags, routines, settings] = await Promise.all([
      repos.tasks.list(),
      repos.tags.list(),
      repos.routines.list(),
      repos.settings.get(),
    ]);
    const o = get().origin;
    const blocks = await repos.blocks.list({
      from: new Date(o.getTime() - 30 * 864e5).toISOString(),
      to: new Date(o.getTime() + 60 * 864e5).toISOString(),
    });
    const taskTags: Record<string, string[]> = {};
    for (const t of tasks) taskTags[t.id] = (await repos.tags.tagsOf(t.id)).map((x) => x.id);
    set({ tasks, blocks, tags, taskTags, routines, settings: settings ?? defaultSettings(), ready: true });
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
  setSearch: (search) => set({ search }),
  setZoom: (zoom) => set({ zoom }),
  setOrigin: (origin) => set({ origin }),
  setSnapDisabled: (snapDisabled) => set({ snapDisabled }),

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

  async saveTask(t) {
    const saved = await repos.tasks.upsert(t);
    set((s) => ({ tasks: s.tasks.map((x) => (x.id === saved.id ? saved : x)) }));
  },

  async toggleDone(id) {
    const t = get().tasks.find((x) => x.id === id);
    if (!t) return;
    const done = t.status !== 'done';
    const next = {
      ...t,
      status: done ? 'done' : 'todo',
      completed_at: done ? new Date().toISOString() : null,
    } as Task;
    // 자식이 있는 할 일의 progress는 자식이 정한다 (3.6). 없으면 자기 status.
    next.progress = progressOf(next, get().tasks);
    await get().saveTask(next);
    // 부모가 있으면 부모 progress를 따라 올린다
    const pu = parentUpdate(next, get().tasks);
    if (pu) await get().saveTask(pu);
  },

  async removeTask(id) {
    const st = get();
    const kids = st.tasks.filter((t) => t.parent_id === id && !t.deleted_at);
    for (const k of [...kids, ...st.tasks.filter((t) => t.id === id)]) {
      await repos.tasks.remove(k.id);
    }
    // 이 할 일에 붙은 블록도 같이 툼스톤 — Task 없는 Block은 '순수 일정'으로 오해된다
    const gone = new Set([id, ...kids.map((k) => k.id)]);
    for (const b of st.blocks.filter((b) => b.task_id && gone.has(b.task_id))) {
      await repos.blocks.remove(b.id);
    }
    set((s) => ({
      tasks: s.tasks.filter((t) => !gone.has(t.id)),
      blocks: s.blocks.filter((b) => !(b.task_id && gone.has(b.task_id))),
      selectedTaskId: s.selectedTaskId && gone.has(s.selectedTaskId) ? null : s.selectedTaskId,
    }));
    // 부모가 있었으면 부모 progress 재계산
    const removed = st.tasks.find((t) => t.id === id);
    if (removed?.parent_id) {
      const parent = get().tasks.find((t) => t.id === removed.parent_id);
      if (parent) await get().saveTask({ ...parent, progress: progressOf(parent, get().tasks) });
    }
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

  async addTag(name, color) {
    const clean = name.trim();
    if (!clean) return null;
    // UNIQUE(user_id, name) — 5장. 로컬에서도 같은 규칙을 지킨다.
    if (get().tags.some((t) => t.name === clean && !t.deleted_at)) return null;
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
    if (patch.name !== undefined) {
      const clean = patch.name.trim();
      if (!clean) return;
      if (get().tags.some((t) => t.id !== id && t.name === clean && !t.deleted_at)) return;
      patch = { ...patch, name: clean };
    }
    const saved = await repos.tags.upsert({ ...cur, ...patch });
    set((s) => ({ tags: s.tags.map((t) => (t.id === id ? saved : t)) }));
  },

  async removeTag(id) {
    await repos.tags.remove(id); // 툼스톤. 물리 삭제하지 않는다 (7장)
    set((s) => {
      const taskTags: Record<string, string[]> = {};
      for (const [taskId, ids] of Object.entries(s.taskTags)) {
        taskTags[taskId] = ids.filter((x) => x !== id);
      }
      return {
        tags: s.tags.filter((t) => t.id !== id),
        selectedTagIds: s.selectedTagIds.filter((x) => x !== id),
        taskTags,
      };
    });
  },

  async setTaskTags(taskId, tagIds) {
    await repos.tags.setTaskTags(taskId, tagIds);
    set((s) => ({ taskTags: { ...s.taskTags, [taskId]: tagIds } }));
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

  setNotice(m) {
    set({ notice: m });
  },

  async scheduleTask(taskId, startAt) {
    const t = get().tasks.find((x) => x.id === taskId);
    if (!t) return null;

    // 블록 길이 = 예상 소요시간이 아니다. "이번에 얼마나 할 것인가"다 (core/fit.ts).
    // 앱 store와 같은 함수를 쓴다 — 웹에서 잡은 것과 앱에서 잡은 것의 길이가 달라지면 안 된다.
    const want = remainingToSchedule(t, get().blocks) || Math.max(t.estimate_min, 15);
    const fit = fitBlock({ start: startAt, wantMinutes: want, existing: get().blocks });
    if (fit.tooSmall) {
      set({ notice: `여기는 ${fit.minutes}분뿐이라 잡지 않았다` });
      return fit;
    }

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
    if (fit.truncated) {
      set({ notice: `${fitSummary(fit, want)} (${FIT_LIMIT_LABEL[fit.limitedBy]})` });
    }
    return fit;
  },
}));

import type { AutoScheduleResult, Block, FitResult, Proposal, Routine, Settings, SleepPattern, Tag, Task, ZoomLevel } from '@sigwan/core';
import {
  addDays,
  autoSchedule,
  DEFAULT_GAP_MIN,
  endOfWakingDay,
  DEFAULT_SLEEP,
  FIT_LIMIT_LABEL,
  fitBlock,
  filterByView,
  newId,
  parentUpdate,
  progressOf,
  fitSummary,
  nowIso,
  proposalToBlock,
  ymd,
  remainingToSchedule,
  type ViewKey,
  viewThatShows,
} from '@sigwan/core';
import { useLayout } from './lib/layout';
import { create } from 'zustand';
import { repos, seedIfEmpty } from './lib/db';

export type { ViewKey };

/** 오늘 = 지금부터 내일 기상 전까지 (core/endOfWakingDay), 7일 = 지금부터 이레 */
export type AutoRange = 'today' | 'week';

interface State {
  ready: boolean;
  tasks: Task[];
  blocks: Block[];
  tags: Tag[];
  taskTags: Record<string, string[]>;
  /** 3.8 고정 일정 — 저장은 규칙으로, 화면에서 그때그때 펼친다 */
  routines: Routine[];
  /** 체크한 것만 담는다. 키는 `${routine_id}:${day}` (core/checkKey) */
  routineChecks: Record<string, true>;
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

  /**
   * 3.8 자동 배치 제안. **저장된 것이 아니다** — 사람이 보고 고치고 「적용」을 눌러야 Block이 된다.
   * 남의 일정을 말없이 바꾸지 않는다 (명세 15장).
   */
  proposals: Proposal[];
  /** 못 넣은 것·빈 시간 같은 요약. 제안보다 이쪽이 중요한 정보다 */
  autoResult: AutoScheduleResult | null;
  /** 배치 범위. 카드 안에서 바꾸면 그 자리에서 다시 계산한다 */
  autoRange: AutoRange;
  /** 손으로 옮기거나 지운 제안이 있는가 — 다시 계산할 때 말해줘야 한다 */
  autoEdited: boolean;
  propose: (range?: AutoRange) => void;
  editProposal: (key: string, patch: { start?: Date; end?: Date }) => void;
  dropProposal: (key: string) => void;
  clearProposals: () => void;
  applyProposals: () => Promise<void>;

  /** 3.8 설정 — 수면 네 값과 자동 배치 간격 */
  saveSleep: (sleep: SleepPattern) => Promise<void>;
  setGapMin: (min: number) => Promise<void>;
  saveRoutine: (r: Routine) => Promise<void>;
  addRoutine: (draft: Omit<Routine, 'id' | 'user_id' | 'deleted_at' | 'rev'>) => Promise<string>;
  removeRoutine: (id: string) => Promise<void>;
  /** 그 날짜의 고정 일정 체크를 켜고 끈다 */
  toggleRoutineCheck: (routineId: string, day: string) => Promise<void>;

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
  routineChecks: {},
  settings: defaultSettings(),
  proposals: [],
  autoResult: null,
  autoRange: 'week',
  autoEdited: false,

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
    const checkRows = await repos.routineChecks.listRange(
      ymd(new Date(o.getTime() - 30 * 864e5)),
      ymd(new Date(o.getTime() + 60 * 864e5)),
    );
    const routineChecks: Record<string, true> = {};
    for (const c of checkRows) routineChecks[c.id] = true;
    const taskTags: Record<string, string[]> = {};
    for (const t of tasks) taskTags[t.id] = (await repos.tags.tagsOf(t.id)).map((x) => x.id);
    set({ tasks, blocks, tags, taskTags, routines, routineChecks, settings: settings ?? defaultSettings(), ready: true });
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

  /**
   * 범위를 더 넓히지 않는다. "다다음 주 화요일 오전"은 지켜지지 않는 약속이고,
   * 그런 게 쌓이면 제안 전체를 안 믿게 된다.
   */
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
    if (st.autoEdited) {
      set({ notice: '범위를 바꿔 다시 계산했다 — 옮겨둔 제안은 사라졌다' });
    } else if (!res.proposals.length) {
      set({
        notice: res.unplaced.length
          ? '넣을 자리가 없다 — 아래에서 이유를 본다'
          : r === 'today'
            ? '오늘 남은 시간에는 넣을 자리가 없다'
            : '자동으로 잡을 할 일이 없다',
      });
    }
  },

  editProposal(key, patch) {
    set({ autoEdited: true });
    set((s) => ({
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
    const ps = get().proposals;
    for (const p of ps) {
      await get().saveBlock(proposalToBlock(p, newId(), 'local-user'));
    }
    const min = ps.reduce((m, p) => m + p.minutes, 0);
    set({
      proposals: [],
      autoResult: null,
      autoEdited: false,
      notice: `${ps.length}개 · ${Math.round((min / 60) * 10) / 10}시간을 넣었다`,
    });
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

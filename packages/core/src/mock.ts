import { newId } from './id';
import type { Block, Tag, Task, TaskTag } from './types';

/**
 * 16.8 — M0에 다 같이 만드는 것 4번: 목 데이터 세트 (Task 50 / Block 30 / 태그 8).
 * 이게 없으면 UI 담당들이 백엔드를 기다린다.
 *
 * 시드 고정 난수를 쓴다 — 새로고침마다 화면이 달라지면 레이아웃 버그를 못 본다.
 */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAG_DEFS: [string, string][] = [
  ['학교', '#3e63dd'],
  ['SINE', '#8e4ec6'],
  ['알바', '#f76b15'],
  ['운동', '#30a46c'],
  ['집안일', '#8b8d98'],
  ['포폴', '#e5484d'],
  ['공부', '#0d9488'],
  ['약속', '#d6409f'],
];

const TITLES_DEADLINE = [
  '운영체제 과제 3',
  'SINE 세미나 발표자료',
  '알고리즘 과제 제출',
  '컴퓨터구조 퀴즈 준비',
  '선형대수 중간 정리',
  '학회 회고 문서',
  '포트폴리오 리뉴얼',
  '리버싱 스터디 정리본',
  '자료구조 레포트',
  '동아리 예산안 제출',
  '토익 접수',
  '교양 에세이',
  '인턴 지원서',
  'CTF 라이트업',
  '프로젝트 명세 검토',
];
const TITLES_DAY = [
  '설거지',
  '빨래 돌리기',
  '헬스장',
  '장보기',
  '메일 답장',
  '방 정리',
  '러닝 5km',
  '스터디 예습',
  '약 먹기',
  '일기 쓰기',
];
const TITLES_SOMEDAY = [
  '블로그 시작하기',
  '기타 배우기',
  '토이 프로젝트 아이디어 정리',
  '읽을 책 목록 정리',
  '깃허브 프로필 꾸미기',
];
const TITLES_EVENT = ['운영체제 강의', 'SINE 정기모임', '알바', '스터디', '점심 약속'];

export interface MockData {
  tags: Tag[];
  tasks: Task[];
  blocks: Block[];
  taskTags: TaskTag[];
}

export function makeMockData(now: Date = new Date(), seed = 20251895): MockData {
  const rnd = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const iso = (d: Date) => d.toISOString();
  const shift = (base: Date, ms: number) => new Date(base.getTime() + ms);
  const H = 3_600_000;
  const D = 24 * H;
  const localDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const userId = 'local-user';
  const createdAt = iso(shift(now, -30 * D));

  const tags: Tag[] = TAG_DEFS.map(([name, color], i) => ({
    id: newId(),
    user_id: userId,
    name,
    color,
    sort_order: i,
    deleted_at: null,
    rev: 0,
  }));

  const tasks: Task[] = [];
  const taskTags: TaskTag[] = [];

  const base = (title: string): Task => ({
    id: newId(),
    user_id: userId,
    title,
    notes: rnd() < 0.25 ? '메모 한 줄. **마크다운**이 들어갈 수 있다 → 렌더 전 정화 필요' : null,
    kind: 'deadline',
    status: 'todo',
    day_of: null,
    start_at: null,
    due_at: null,
    estimate_min: 60,
    spent_min: 0,
    importance: 3,
    progress: 0,
    pinned: false,
    parent_id: null,
    rrule: null,
    sort_order: tasks.length * 1000,
    score: null,
    source: 'manual',
    estimate_is_ai: false,
    is_locked: false,
    enc_blob: null,
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: null,
    deleted_at: null,
    rev: 0,
  });

  const attachTags = (t: Task) => {
    const n = int(0, 2);
    const used = new Set<number>();
    for (let i = 0; i < n; i++) {
      const idx = int(0, tags.length - 1);
      if (used.has(idx)) continue;
      used.add(idx);
      taskTags.push({ task_id: t.id, tag_id: (tags[idx] as Tag).id });
    }
  };

  // 기한 투두 28개 — 지난 것 3개 포함 (마감 지남 부스트가 화면에 보여야 한다)
  for (let i = 0; i < 28; i++) {
    const t = base(`${pick(TITLES_DEADLINE)} ${i + 1}`);
    const offsetH = i < 3 ? -int(4, 72) : int(2, 24 * 30);
    t.due_at = iso(shift(now, offsetH * H));
    t.estimate_min = pick([15, 30, 60, 90, 120, 180, 240, 360, 600, 1200]);
    t.importance = int(1, 5);
    if (rnd() < 0.3) t.start_at = iso(shift(now, -int(1, 5) * D));
    if (rnd() < 0.25) t.spent_min = Math.floor(t.estimate_min * rnd() * 0.6);
    if (rnd() < 0.12) t.status = 'doing';
    if (rnd() < 0.15) {
      t.status = 'done';
      t.completed_at = iso(shift(now, -int(1, 200) * H));
      t.progress = 1;
    }
    if (i === 0) t.pinned = true;
    tasks.push(t);
    attachTags(t);
  }

  // 하루 투두 12개 — 어제/오늘/내일
  for (let i = 0; i < 12; i++) {
    const t = base(pick(TITLES_DAY));
    t.kind = 'day';
    t.day_of = localDate(shift(now, (int(0, 2) - 1) * D));
    t.estimate_min = pick([10, 15, 30, 45, 60]);
    t.importance = int(1, 4);
    if (rnd() < 0.3) {
      t.status = 'done';
      t.completed_at = iso(now);
      t.progress = 1;
    }
    tasks.push(t);
    attachTags(t);
  }

  // 인박스 10개 — 그중 4개는 AI 초안 (3.7.1). 정렬에서 빠지는지 눈으로 확인하려고 넣는다
  for (let i = 0; i < 10; i++) {
    const isAi = i >= 6;
    const t = base(isAi ? `${pick(TITLES_SOMEDAY)} — 1단계` : pick(TITLES_SOMEDAY));
    t.kind = 'someday';
    if (isAi) {
      t.source = 'ai';
      t.estimate_is_ai = true;
      t.estimate_min = pick([30, 60, 120]);
    }
    tasks.push(t);
    attachTags(t);
  }

  // 하위작업 몇 개 — parent progress 자동 계산(3.6)이 도는지 보려고
  const parent = tasks.find((t) => t.kind === 'deadline' && t.status === 'todo');
  if (parent) {
    for (let i = 0; i < 3; i++) {
      const c = base(`${parent.title} — 하위 ${i + 1}`);
      c.kind = 'deadline';
      c.parent_id = parent.id;
      c.due_at = parent.due_at;
      c.estimate_min = 60;
      if (i === 0) {
        c.status = 'done';
        c.completed_at = iso(now);
        c.progress = 1;
      }
      tasks.push(c);
    }
  }

  // Block 30개 — 오늘 기준 ±3일. 일부러 겹치게 만든다 (레인 분리 확인)
  const blocks: Block[] = [];
  const schedulable = tasks.filter((t) => t.kind !== 'someday' && t.status !== 'done');
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let i = 0; i < 30; i++) {
    const dayOffset = int(-3, 3);
    const startHour = int(8, 21);
    const startMin = pick([0, 15, 30, 45]);
    const durationMin = pick([30, 60, 90, 120, 180]);
    const start = new Date(startOfToday.getTime() + dayOffset * D + startHour * H + startMin * 60_000);
    const linked = rnd() < 0.7 ? pick(schedulable) : null;
    blocks.push({
      id: newId(),
      user_id: userId,
      task_id: linked ? linked.id : null,
      title: linked ? null : pick(TITLES_EVENT),
      start_at: iso(start),
      end_at: iso(shift(start, durationMin * 60_000)),
      is_all_day: false,
      source: rnd() < 0.5 ? 'drag' : 'manual',
      deleted_at: null,
      rev: 0,
    });
  }

  return { tags, tasks, blocks, taskTags };
}

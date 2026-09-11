import type { Task } from '@sigwan/core';
import { GRADE_COLOR, GRADE_LABEL, priorityScore, sortByPriority } from '@sigwan/core';
import type * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dueFields } from '../lib/taskDate';
import { useStore } from '../store';

/**
 * 3.3 직접 추가 — 칸을 나눈 폼.
 *
 * 명세가 못 박은 다섯 가지를 그대로 지킨다:
 *  1. 필수는 제목 하나. 나머지는 전부 기본값이 있다 (est 60분, importance 3)
 *  2. 날짜·소요시간은 칩으로 한 번에. 「직접」은 옆에 작게 — 텍스트 입력은 키보드 전환이다
 *  3. kind를 사용자가 고르지 않는다. 입력에서 자동 결정된다
 *  4. 저장 전에 등급·순위를 보여준다. 이게 없으면 중요도가 전부 3으로 남고
 *     점수 공식의 I 항(가중치 0.4)이 죽는다
 *  5. 중요도는 접지 않는다 — 접힌 필드는 사실상 안 쓰인다
 */

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
/** 다가오는 토요일 (오늘이 토요일이면 오늘) */
function nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d;
}
/** 다음 주 월요일 */
function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
}

const DATE_CHIPS: [string, () => string | null][] = [
  ['없음', () => null],
  ['오늘', () => ymd(new Date())],
  ['내일', () => ymd(addDays(1))],
  ['이번 주말', () => ymd(nextSaturday())],
  ['다음 주', () => ymd(nextMonday())],
];

const EST_CHIPS: [string, number][] = [
  ['15분', 15],
  ['30분', 30],
  ['1시간', 60],
  ['2시간', 120],
  ['4시간', 240],
];

export function AddTask({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addTask, tags, tasks, revealTask } = useStore();
  const ref = useRef<HTMLDialogElement>(null);

  const [title, setTitle] = useState('');
  const [dateStr, setDateStr] = useState<string | null>(null);
  /**
   * 어떤 칩을 눌렀는가. 날짜 값으로 켜짐을 판단하면 안 된다 —
   * 금요일에는 「내일」과 「이번 주말」이 같은 날짜라 칩 두 개가 동시에 켜진다.
   */
  const [datePreset, setDatePreset] = useState('없음');
  const [timeStr, setTimeStr] = useState('');
  const [estMin, setEstMin] = useState(60);
  const [importance, setImportance] = useState(3);
  const [customEst, setCustomEst] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [startAt, setStartAt] = useState('');
  const [scheduleNow, setScheduleNow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function reset() {
    setTitle('');
    setDateStr(null);
    setDatePreset('없음');
    setTimeStr('');
    setEstMin(60);
    setImportance(3);
    setCustomEst(false);
    setTagIds([]);
    setNotes('');
    setStartAt('');
    setScheduleNow(false);
  }

  // 3.3-3 — kind는 입력이 결정한다
  const draft = useMemo((): Partial<Task> & { title: string } => {
    return {
      title: title || '(제목 없음)',
      estimate_min: estMin,
      importance,
      ...dueFields(dateStr, timeStr),
    };
  }, [title, dateStr, timeStr, estMin, importance]);

  // 3.3-4 — 저장 전 등급·순위 미리보기. 중요도를 4→5로 바꾸면 여기가 즉시 바뀐다.
  const preview = useMemo(() => {
    const now = new Date();
    const fake = { ...BLANK, ...draft, id: '__draft__' } as Task;
    const s = priorityScore(fake, now);
    if (!Number.isFinite(s.score)) return { s, rank: null as number | null, total: 0 };
    const live = tasks.filter((t) => !t.deleted_at && t.status !== 'done' && t.kind !== 'someday');
    const sorted = sortByPriority([...live, fake], now);
    return { s, rank: sorted.findIndex((t) => t.id === '__draft__') + 1, total: sorted.length };
  }, [draft, tasks]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const id = await addTask(
        { ...draft, title, notes: notes.trim() || null, start_at: startAt ? new Date(startAt).toISOString() : null },
        { tagIds, scheduleNow },
      );
      revealTask(id);
      reset();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="add-dialog" onClose={onClose} onCancel={onClose}>
      <form onSubmit={submit}>
        <header className="add-head">
          <strong>할 일 추가</strong>
          <button type="button" className="ghost-btn" onClick={onClose}>
            닫기 (Esc)
          </button>
        </header>

        <div className="add-body">
          {/* ── 항상 보이는 필드 4개 ───────────────────────────── */}
          <label className="fld">
            <span className="fld-label">제목</span>
            {/* biome-ignore lint/a11y/noAutofocus: 모달이 열리는 이유가 이 칸이다 */}
            <input
              autoFocus
              className="txt"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="무엇을 해야 하나"
              maxLength={200}
            />
          </label>

          <div className="fld">
            <span className="fld-label">언제까지</span>
            <div className="chips">
              {DATE_CHIPS.map(([label, get]) => (
                <button
                  key={label}
                  type="button"
                  className="chip"
                  aria-pressed={datePreset === label}
                  onClick={() => {
                    const v = get();
                    setDatePreset(label);
                    setDateStr(v);
                    if (v === null) setTimeStr('');
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="chip chip-alt"
                aria-pressed={datePreset === '직접'}
                onClick={() => setDatePreset('직접')}
              >
                직접
              </button>
            </div>
            {datePreset === '직접' && (
              <input
                type="date"
                className="txt txt-sm"
                value={dateStr ?? ''}
                onChange={(e) => setDateStr(e.target.value || null)}
              />
            )}
            {dateStr && (
              <div className="sub-row">
                <span className="sub-label">시각</span>
                <input
                  type="time"
                  className="txt txt-sm"
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                />
                <span className="hint">
                  비우면 그날 하루 할 일, 넣으면 기한 투두가 된다
                </span>
              </div>
            )}
          </div>

          <div className="fld">
            <span className="fld-label">얼마나 걸릴까</span>
            <div className="chips">
              {EST_CHIPS.map(([label, v]) => (
                <button
                  key={v}
                  type="button"
                  className="chip"
                  aria-pressed={!customEst && estMin === v}
                  onClick={() => {
                    setCustomEst(false);
                    setEstMin(v);
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="chip chip-alt"
                aria-pressed={customEst}
                onClick={() => setCustomEst((v) => !v)}
              >
                직접
              </button>
            </div>
            {customEst && (
              <div className="sub-row">
                <input
                  type="number"
                  className="txt txt-sm"
                  min={5}
                  step={5}
                  value={estMin}
                  onChange={(e) => setEstMin(Math.max(5, Number(e.target.value)))}
                  style={{ width: 90 }}
                />
                <span className="sub-label">분</span>
              </div>
            )}
          </div>

          {/* 3.3-5 중요도는 접지 않는다 */}
          <div className="fld">
            <span className="fld-label">중요도</span>
            <div className="chips">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  className="chip chip-num"
                  aria-pressed={importance === v}
                  onClick={() => setImportance(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* ── 세부 설정 (접힘) ──────────────────────────────── */}
          <details className="more">
            <summary>세부 설정</summary>

            <div className="fld">
              <span className="fld-label">태그</span>
              <div className="chips">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="chip"
                    aria-pressed={tagIds.includes(t.id)}
                    onClick={() =>
                      setTagIds((ids) =>
                        ids.includes(t.id) ? ids.filter((x) => x !== t.id) : [...ids, t.id],
                      )
                    }
                  >
                    <i className="tagdot" style={{ background: t.color }} /> {t.name}
                  </button>
                ))}
              </div>
            </div>

            <label className="fld">
              <span className="fld-label">시작일</span>
              <input
                type="date"
                className="txt txt-sm"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </label>

            <label className="fld fld-inline">
              <input
                type="checkbox"
                checked={scheduleNow}
                onChange={(e) => setScheduleNow(e.target.checked)}
              />
              <span>지금 블록 잡기 — 현재 시각부터 {fmtEst(estMin)}짜리 블록을 만든다</span>
            </label>

            <label className="fld">
              <span className="fld-label">메모</span>
              <textarea
                className="txt"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            <p className="hint">반복(RRULE)은 M5다 — 스키마 자리만 비워뒀다.</p>
          </details>
        </div>

        {/* ── 저장 전 미리보기 ─────────────────────────────── */}
        <footer className="add-foot">
          <div className="add-preview">
            <span className="grade-pill" style={{ background: GRADE_COLOR[preview.s.grade] }}>
              {draft.kind === 'someday' ? '인박스' : GRADE_LABEL[preview.s.grade]}
            </span>
            <span className="add-preview-text">{sentence(draft, preview)}</span>
          </div>
          <button type="submit" className="primary-btn" disabled={!title.trim() || busy}>
            추가
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function sentence(
  draft: Partial<Task> & { title: string },
  p: { s: ReturnType<typeof priorityScore>; rank: number | null; total: number },
) {
  if (draft.kind === 'someday') {
    return '인박스로 들어간다 — 날짜를 정하기 전까지 급한 순 정렬에서 빠진다';
  }
  const when =
    draft.kind === 'day'
      ? `${fmtDate(draft.day_of as string)} 하루 할 일`
      : `${new Date(draft.due_at as string).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 마감`;
  const rank = p.rank ? ` · 급한 순 ${p.rank}/${p.total}번째` : '';
  return `${when} · ${fmtEst(draft.estimate_min ?? 60)} · 점수 ${p.s.score.toFixed(1)}${rank}`;
}

function fmtDate(s: string) {
  const [, m, d] = s.split('-');
  return `${Number(m)}월 ${Number(d)}일`;
}

function fmtEst(min: number) {
  if (min >= 60) return `${(min / 60).toFixed(min % 60 ? 1 : 0)}시간`;
  return `${min}분`;
}

/** priorityScore가 요구하는 나머지 필드의 기본값 */
const BLANK = {
  user_id: 'local-user',
  notes: null,
  status: 'todo',
  day_of: null,
  start_at: null,
  due_at: null,
  spent_min: 0,
  progress: 0,
  pinned: false,
  parent_id: null,
  rrule: null,
  sort_order: 0,
  score: null,
  source: 'manual',
  estimate_is_ai: false,
  is_locked: false,
  enc_blob: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  deleted_at: null,
  rev: 0,
} as const;

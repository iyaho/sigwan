import type { Routine, SleepPattern } from '@sigwan/core';
import { WEEKDAY_SHORT, hhmm, parseHhmm, ymd } from '@sigwan/core';
import type * as React from 'react';
import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { ColorPicker, TAG_COLORS } from './Sidebar';

/**
 * 3.8 고정 일정 — 시간표에 직접 그린다.
 *
 * 폼으로 받으면 "화요일 10시 반에 뭐가 있더라"를 머리로 계산해야 한다. 격자에 그려두면
 * 빈 자리가 눈에 보이고, 겹침도 눈에 보인다. 학교 시간표를 옮겨 적는 일이라 이 편이 빠르다.
 *
 * 데이터는 그대로다. Routine 한 행이 "월·수 10:30–12:00"이라 격자에는 블록 두 개로 그려지고,
 * 편집창의 요일 칩이 그 한 행을 고친다. 요일을 끄면 그 요일만 빠지고, 삭제는 그 과목 전체다.
 */

const GUTTER = 44;
const PX_PER_MIN = 0.7; // 42px/시간
const SNAP = 15;
const MIN_LEN = 15;

/** 기본 표시 범위. 등록된 일정이 이 밖으로 나가면 그만큼 넓힌다 */
const BASE_START = 8 * 60;
const BASE_END = 22 * 60;

const isWeekendWake = (wd: number) => wd === 5 || wd === 6;

/**
 * 그 요일 칸에 깔릴 수면 띠.
 *  - 아침 부분: 이 날 일어나므로 이 날의 규칙을 쓴다
 *  - 저녁 부분: 내일 일어나므로 내일의 규칙을 쓴다 (자정을 넘는 경우에만 생긴다)
 */
function sleepBands(wd: number, s: SleepPattern): [number, number][] {
  const startOf = (w: number) => (isWeekendWake(w) ? s.weekendStart : s.weekdayStart);
  const endOf = (w: number) => (isWeekendWake(w) ? s.weekendEnd : s.weekdayEnd);
  const out: [number, number][] = [];
  const myStart = startOf(wd);
  const myEnd = endOf(wd);
  out.push(myStart < myEnd ? [myStart, myEnd] : [0, myEnd]);
  const tmr = (wd + 1) % 7;
  if (startOf(tmr) > endOf(tmr)) out.push([startOf(tmr), 1440]);
  return out.filter(([a, b]) => b > a);
}

interface Editing {
  /** null이면 새로 만드는 중 */
  id: string | null;
  name: string;
  weekdays: number[];
  start: number;
  end: number;
  color: string;
  from: string;
  to: string;
}

export function RoutineGrid() {
  const { routines, settings, addRoutine, saveRoutine, removeRoutine } = useStore();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [edit, setEdit] = useState<Editing | null>(null);
  const [drag, setDrag] = useState<{ wd: number; from: number; to: number } | null>(null);
  const [weekendOn, setWeekendOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasWeekend = routines.some((r) => r.weekdays.some((w) => w >= 5));
  const showWeekend = weekendOn || hasWeekend || (edit?.weekdays.some((w) => w >= 5) ?? false);
  const days = showWeekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];

  const [rangeStart, rangeEnd] = useMemo(() => {
    let s = BASE_START;
    let e = BASE_END;
    for (const r of routines) {
      s = Math.min(s, r.start_min);
      e = Math.max(e, r.end_min);
    }
    if (edit) {
      s = Math.min(s, edit.start);
      e = Math.max(e, edit.end);
    }
    return [Math.floor(s / 60) * 60, Math.ceil(e / 60) * 60];
  }, [routines, edit]);

  const height = (rangeEnd - rangeStart) * PX_PER_MIN;
  const y = (min: number) => (Math.min(Math.max(min, rangeStart), rangeEnd) - rangeStart) * PX_PER_MIN;
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = rangeStart; h <= rangeEnd; h += 60) out.push(h);
    return out;
  }, [rangeStart, rangeEnd]);

  const colStyle = (i: number): React.CSSProperties => ({
    left: `calc(${GUTTER}px + ${i} * (100% - ${GUTTER}px) / ${days.length})`,
    width: `calc((100% - ${GUTTER}px) / ${days.length})`,
  });

  /** 겹치는 고정 일정이 있으면 그 이름을 돌려준다 */
  function conflict(wds: number[], s: number, e: number, exceptId: string | null): string | null {
    for (const r of routines) {
      if (r.id === exceptId || r.deleted_at) continue;
      if (s >= r.end_min || e <= r.start_min) continue;
      const hit = r.weekdays.find((w) => wds.includes(w));
      if (hit !== undefined) return `${WEEKDAY_SHORT[hit]} ${r.name}과 겹친다`;
    }
    return null;
  }

  // ── 빈 칸 드래그 → 새 일정 ──────────────────────────────────────
  function posOf(e: { clientX: number; clientY: number }) {
    const el = bodyRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const colW = (r.width - GUTTER) / days.length;
    const idx = Math.floor((e.clientX - r.left - GUTTER) / colW);
    if (idx < 0 || idx >= days.length) return null;
    const raw = (e.clientY - r.top + el.scrollTop) / PX_PER_MIN + rangeStart;
    return { wd: days[idx] as number, min: Math.round(raw / SNAP) * SNAP };
  }

  function onDown(e: React.PointerEvent) {
    if (edit) return; // 편집 중에는 새로 만들지 않는다
    const p = posOf(e);
    if (!p) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ wd: p.wd, from: p.min, to: p.min + MIN_LEN });
  }

  function onMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = posOf(e);
    if (!p) return;
    setDrag({ ...drag, to: Math.max(drag.from + MIN_LEN, p.min) });
  }

  function onUp() {
    if (!drag) return;
    const { wd, from, to } = drag;
    setDrag(null);
    const s = Math.max(rangeStart, Math.min(from, to));
    const t = Math.min(rangeEnd, Math.max(from, to));
    if (t - s < MIN_LEN) return;
    if (conflict([wd], s, t, null)) {
      setErr('이미 다른 고정 일정이 있는 자리다');
      return;
    }
    setErr(null);
    setEdit({
      id: null,
      name: '',
      weekdays: [wd],
      start: s,
      end: t,
      color: TAG_COLORS[routines.length % TAG_COLORS.length] as string,
      // 오늘부터 무기한이 기본. 비워두면 "예전에도 있던 일정"이 되어
      // 지난 주 화면까지 바뀐다 — 학기 중에 새로 넣는 쪽이 압도적으로 흔하다.
      from: ymd(new Date()),
      to: '',
    });
  }

  async function save() {
    if (!edit) return;
    if (!edit.name.trim()) {
      setErr('이름을 넣는다');
      return;
    }
    if (!edit.weekdays.length) {
      setErr('요일을 하나 이상 고른다');
      return;
    }
    if (edit.end <= edit.start) {
      setErr('끝나는 시각이 시작보다 빠르다. 자정을 넘는 일정은 둘로 나눠 넣는다');
      return;
    }
    const c = conflict(edit.weekdays, edit.start, edit.end, edit.id);
    if (c) {
      setErr(c);
      return;
    }

    const body = {
      name: edit.name.trim(),
      weekdays: [...edit.weekdays].sort((a, b) => a - b),
      start_min: edit.start,
      end_min: edit.end,
      color: edit.color,
      active_from: edit.from || null,
      active_to: edit.to || null,
    };
    if (edit.id) {
      const cur = routines.find((r) => r.id === edit.id);
      if (cur) await saveRoutine({ ...cur, ...body });
    } else {
      await addRoutine(body);
    }
    setEdit(null);
    setErr(null);
  }

  const dragBox = drag
    ? { wd: drag.wd, s: Math.min(drag.from, drag.to), e: Math.max(drag.from, drag.to) }
    : null;
  const dragBad = dragBox ? !!conflict([dragBox.wd], dragBox.s, dragBox.e, null) : false;

  return (
    <div className="rg">
      <div className="rg-head">
        <span style={{ width: GUTTER }} />
        {days.map((wd) => (
          <span key={wd} className="rg-dow" style={{ flex: 1 }}>
            {WEEKDAY_SHORT[wd]}
          </span>
        ))}
      </div>

      <div
        className="rg-body"
        ref={bodyRef}
        style={{ height }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {hours.map((h) => (
          <div key={h} className="rg-line" style={{ top: y(h) }}>
            <span className="rg-time">{hhmm(h)}</span>
          </div>
        ))}

        {days.map((wd, i) => (
          <div key={wd} className={`rg-col${isWeekendWake(wd) ? ' weekend' : ''}`} style={colStyle(i)}>
            {/* 수면 — 자동 배치가 피하는 자리. 누를 수 없다 */}
            {sleepBands(wd, settings.sleep).map(([a, b]) => (
              <div key={a} className="rg-sleep" style={{ top: y(a), height: Math.max(0, y(b) - y(a)) }} />
            ))}

            {routines
              .filter((r) => r.weekdays.includes(wd))
              .map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="rg-block"
                  aria-pressed={edit?.id === r.id}
                  style={{
                    top: y(r.start_min),
                    height: Math.max(14, y(r.end_min) - y(r.start_min)),
                    background: r.color,
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setErr(null);
                    setEdit({
                      id: r.id,
                      name: r.name,
                      weekdays: r.weekdays,
                      start: r.start_min,
                      end: r.end_min,
                      color: r.color,
                      from: r.active_from ?? '',
                      to: r.active_to ?? '',
                    });
                  }}
                >
                  <b>{r.name}</b>
                  {y(r.end_min) - y(r.start_min) > 34 && (
                    <span>
                      {hhmm(r.start_min)}–{hhmm(r.end_min)}
                    </span>
                  )}
                </button>
              ))}

            {dragBox?.wd === wd && (
              <div
                className="rg-draft"
                data-bad={dragBad}
                style={{ top: y(dragBox.s), height: Math.max(2, y(dragBox.e) - y(dragBox.s)) }}
              >
                {hhmm(dragBox.s)}–{hhmm(dragBox.e)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rg-foot">
        <span className="hint">빈 칸을 세로로 끌면 새 일정이 생긴다. 블록을 누르면 고친다.</span>
        {!hasWeekend && (
          <button type="button" className="icon-btn" onClick={() => setWeekendOn((v) => !v)}>
            {showWeekend ? '주말 숨기기' : '+ 주말'}
          </button>
        )}
      </div>

      {err && !edit && <p className="err">{err}</p>}

      {edit && (
        <div className="set-form">
          <div className="sub-row">
            {/* biome-ignore lint/a11y/noAutofocus: 드래그가 끝나면 다음 동작은 이름 입력이다 */}
            <input
              autoFocus={!edit.id}
              className="txt txt-sm"
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              placeholder="자료구조 / 알바"
              maxLength={100}
              style={{ flex: 1 }}
            />
            <input
              type="time"
              className="txt txt-sm"
              value={hhmm(edit.start)}
              onChange={(e) => {
                const v = parseHhmm(e.target.value);
                if (v !== null) setEdit({ ...edit, start: v });
              }}
            />
            <span className="sub-label">~</span>
            <input
              type="time"
              className="txt txt-sm"
              value={hhmm(edit.end)}
              onChange={(e) => {
                const v = parseHhmm(e.target.value);
                if (v !== null) setEdit({ ...edit, end: v });
              }}
            />
          </div>

          <div className="chips">
            {WEEKDAY_SHORT.map((w, i) => (
              <button
                key={w}
                type="button"
                className="chip"
                aria-pressed={edit.weekdays.includes(i)}
                onClick={() =>
                  setEdit({
                    ...edit,
                    weekdays: edit.weekdays.includes(i)
                      ? edit.weekdays.filter((x) => x !== i)
                      : [...edit.weekdays, i],
                  })
                }
              >
                {w}
              </button>
            ))}
          </div>

          <div className="sub-row">
            <span className="sub-label">색</span>
            <ColorPicker value={edit.color} onChange={(c) => setEdit({ ...edit, color: c })} />
            <span className="sub-label" style={{ marginLeft: 'auto' }}>
              학기
            </span>
            <input type="date" className="txt txt-sm" value={edit.from} onChange={(e) => setEdit({ ...edit, from: e.target.value })} />
            <span className="sub-label">~</span>
            <input type="date" className="txt txt-sm" value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })} />
          </div>
          <span className="hint">오늘부터 무기한이 기본이다. 끝나는 날을 넣어두면 그 뒤로는 자동 배치가 이 자리를 비운다.</span>

          {err && <p className="err">{err}</p>}

          <div className="sub-row">
            <button type="button" className="primary-btn primary-btn-sm" onClick={() => void save()}>
              {edit.id ? '저장' : '추가'}
            </button>
            <button type="button" className="ghost-btn" onClick={() => { setEdit(null); setErr(null); }}>
              취소
            </button>
            {edit.id && (
              <button
                type="button"
                className="icon-btn danger"
                style={{ marginLeft: 'auto' }}
                onClick={async () => {
                  await removeRoutine(edit.id as string);
                  setEdit(null);
                }}
              >
                삭제
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

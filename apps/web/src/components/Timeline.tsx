import type * as React from 'react';
import type { Block, ZoomLevel } from '@sigwan/core';
import {
  GRADE_COLOR,
  MIN_DRAGGABLE_PX,
  ZOOMS,
  isOutOfRange,
  isWeekend,
  layoutBlocks,
  priorityScore,
  pxToTime,
  snap,
  ticks,
  timeToPx,
} from '@sigwan/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { rangeProgress } from '../lib/views';
import { useStore } from '../store';

/**
 * 모듈 ① 타임라인 엔진의 최소 구현.
 *
 * 지켜야 하는 것 셋:
 *  1. 좌표는 core의 timeToPx/pxToTime만 쓴다. 컴포넌트에서 직접 계산하지 않는다.
 *  2. 드래그 중에는 transform만 바꾸고 state를 건드리지 않는다 (리렌더 = 끊김).
 *  3. 저장은 포인터를 뗄 때 한 번. DB에는 스냅되지 않은 정확한 값이 들어간다.
 *
 * 일(day) 줌은 세로, 나머지는 가로다. 주 뷰에서 2시간 Block은 4.8px이라
 * 조작이 불가능하므로 읽기 전용으로 잠근다 (명세 3.1의 수정 후보).
 */

const GUTTER = 52;
const LANE_W = 148; // 세로 뷰에서 레인 하나 폭
const LANE_H = 26; // 가로 뷰에서 레인 하나 높이
const ROW_GAP = 4;
const HEAD_H = 40; // 가로 뷰 상단 날짜 헤더
const GHOST_H = 16; // 기간 막대(고스트) 높이
const DAY_MS = 864e5;

/** 3px 미만은 드래그가 아니라 클릭이다. 클릭이 데이터를 바꾸면 안 된다. */
const DRAG_THRESHOLD_PX = 3;

interface DragState {
  mode: 'move' | 'resize';
  id: string;
  startPx: number;
  origStart: number;
  origEnd: number;
  /**
   * 드래그 시작 시점의 인라인 style 문자열.
   *
   * 여기가 함정이었다 — 드래그 중에 el.style.height를 직접 만지고 끝나서 ''로 지우면,
   * React는 자기가 마지막에 쓴 값(예: 36px)과 다음 렌더 값이 같다고 보고 다시 안 쓴다.
   * 그래서 지운 채로 남아 막대가 내용 크기(113×32)로 쪼그라든다.
   * 지우지 말고 '원래 값으로 되돌린다'.
   */
  origStyle: { height: string; width: string };
}

export function Timeline() {
  const {
    zoom,
    origin,
    blocks,
    tasks,
    snapDisabled,
    saveBlock,
    removeBlock,
    scheduleTask,
    revealTask,
  } = useStore();
  const spec = ZOOMS[zoom];
  const vertical = spec.vertical;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  /** 실제로 움직였는가. 리렌더를 유발하면 안 되므로 ref다. */
  const moved = useRef(false);
  const [, force] = useState(0);

  // Alt 누르면 스냅 해제 (3.2)
  useEffect(() => {
    const on = (e: KeyboardEvent) => useStore.getState().setSnapDisabled(e.altKey);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
    };
  }, []);

  // 일 뷰는 하루 1728px이라 00:00에서 시작하면 아무것도 안 보인다. 지금 시각을 화면 위쪽에 둔다.
  const scrolled = useRef(false);
  useEffect(() => {
    scrolled.current = false;
  }, [zoom]);

  const spanMinutes = vertical ? 24 * 60 : 24 * 60 * (zoom === 'week' ? 14 : zoom === 'month' ? 60 : 200);
  const axisPx = spanMinutes * spec.pxPerMinute;

  const visible = useMemo(() => {
    const from = origin.getTime();
    const to = from + spanMinutes * 60_000;
    return blocks.filter(
      (b) => !b.deleted_at && Date.parse(b.end_at) > from && Date.parse(b.start_at) < to,
    );
  }, [blocks, origin, spanMinutes]);

  const { placed, laneCount } = useMemo(
    () => layoutBlocks(visible, origin, zoom),
    [visible, origin, zoom],
  );

  /**
   * 3.1 막대 2종 — 계획 막대(Block, 실선) / 기간 막대(start_at~due_at, 고스트).
   * 가로 뷰에서만 그린다. 일 뷰는 하루라 기간이 화면을 통째로 덮는다.
   *
   * start_at이 없는 할 일은 막대가 아니라 마감 자리에 마름모 하나(마일스톤).
   * created_at부터 그으면 모든 할 일이 화면 왼쪽 끝에서 시작하는 긴 막대가 되어
   * 레인이 21개까지 늘어났다 — 정보가 없는 걸 있는 것처럼 그리면 안 된다.
   */
  const ghosts = useMemo(() => {
    const empty = { placed: [] as ReturnType<typeof layoutBlocks>['placed'], laneCount: 0 };
    if (vertical) return empty;
    const from = origin.getTime();
    const to = from + spanMinutes * 60_000;
    const pseudo: Block[] = tasks
      .filter((t) => !t.deleted_at && t.status !== 'done' && t.due_at)
      .map((t) => {
        const end = t.due_at as string;
        // 마일스톤은 폭 0 대신 스냅 한 칸 — layoutBlocks가 end>start를 요구한다
        const start = t.start_at ?? new Date(Date.parse(end) - spec.snapMinutes * 60_000).toISOString();
        return {
          id: t.id,
          user_id: t.user_id,
          task_id: t.id,
          title: t.title,
          start_at: start,
          end_at: end,
          is_all_day: false,
          source: 'manual' as const,
          deleted_at: null,
          rev: 0,
        };
      })
      .filter((b) => Date.parse(b.end_at) > from && Date.parse(b.start_at) < to);
    return layoutBlocks(pseudo, origin, zoom);
  }, [tasks, origin, zoom, vertical, spanMinutes, spec.snapMinutes]);

  const ghostBandH = vertical ? 0 : ghosts.laneCount * (GHOST_H + 2) + (ghosts.laneCount ? 10 : 0);
  const blocksTop = HEAD_H + ghostBandH;

  /** 가로 뷰의 주말 음영·오늘 열 */
  const dayColumns = useMemo(() => {
    if (vertical) return [];
    const out: { left: number; width: number; weekend: boolean; today: boolean }[] = [];
    const d0 = new Date(origin);
    d0.setHours(0, 0, 0, 0);
    const todayKey = new Date().toDateString();
    const dayW = 1440 * spec.pxPerMinute;
    for (let d = new Date(d0); d.getTime() < origin.getTime() + spanMinutes * 60_000; d.setDate(d.getDate() + 1)) {
      const left = timeToPx(d, origin, zoom);
      const weekend = isWeekend(d);
      const today = d.toDateString() === todayKey;
      if (weekend || today) out.push({ left, width: dayW, weekend, today });
    }
    return out;
  }, [origin, zoom, vertical, spanMinutes, spec.pxPerMinute]);

  /** ◀ ▶ — 줌 단위만큼 이동 */
  const shift = (dir: 1 | -1) => {
    const days = zoom === 'day' ? 1 : zoom === 'week' ? 7 : zoom === 'month' ? 30 : 91;
    const n = new Date(origin);
    n.setDate(n.getDate() + dir * days);
    useStore.getState().setOrigin(n);
  };

  const rangeProg = useMemo(
    () => rangeProgress(tasks, origin, new Date(origin.getTime() + spanMinutes * 60_000)),
    [tasks, origin, spanMinutes],
  );
  const rangePct = rangeProg.total ? Math.round((rangeProg.done / rangeProg.total) * 100) : null;

  const tickList = useMemo(() => ticks(origin, axisPx, zoom), [origin, axisPx, zoom]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // 현재 시각 선. 렌더 시점에 고정되면 화면을 열어둔 채 30분 지나도 선이 안 움직인다.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowOffset = timeToPx(now, origin, zoom);
  const showNow = nowOffset >= 0 && nowOffset <= axisPx;
  const nowLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || scrolled.current || !showNow) return;
    scrolled.current = true;
    if (vertical) el.scrollTop = Math.max(0, nowOffset - 120);
    else el.scrollLeft = Math.max(0, nowOffset - 200);
  }, [vertical, nowOffset, showNow]);

  // ── 드래그: 포인터 이동 중에는 DOM만 만진다 ──────────────────────────────
  const elRef = useRef<Record<string, HTMLDivElement | null>>({});

  function onPointerDown(e: React.PointerEvent, b: Block, mode: 'move' | 'resize') {
    const dur = (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000;
    if (dur * spec.pxPerMinute < MIN_DRAGGABLE_PX) return; // 주 뷰 = 읽기 전용
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const el = elRef.current[b.id];
    moved.current = false;
    setDrag({
      mode,
      id: b.id,
      startPx: vertical ? e.clientY : e.clientX,
      origStart: Date.parse(b.start_at),
      origEnd: Date.parse(b.end_at),
      origStyle: { height: el?.style.height ?? '', width: el?.style.width ?? '' },
    });
  }

  /**
   * 3.2 — "막대 → 인박스 = Block 삭제 (Task 유지)".
   * 아래 할 일 리스트 영역이 휴지통이다. 위에 있는 동안 리스트가 빨갛게 표시된다.
   */
  function overTrash(e: { clientX: number; clientY: number }): HTMLElement | null {
    const el = document.querySelector<HTMLElement>('[data-drop="trash"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const inside =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    return inside ? el : null;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    if (drag.mode === 'move') {
      const trash = document.querySelector<HTMLElement>('[data-drop="trash"]');
      const hit = overTrash(e);
      if (trash) trash.dataset.hover = hit ? 'true' : 'false';
      const el0 = elRef.current[drag.id];
      if (el0) el0.dataset.trash = hit ? 'true' : 'false';
    }
    const el = elRef.current[drag.id];
    if (!el) return;
    const delta = (vertical ? e.clientY : e.clientX) - drag.startPx;
    if (Math.abs(delta) >= DRAG_THRESHOLD_PX) moved.current = true;
    const deltaMin = delta / spec.pxPerMinute;
    const step = snapDisabled ? 1 : spec.snapMinutes;
    const snappedMin = Math.round(deltaMin / step) * step;
    const px = snappedMin * spec.pxPerMinute;

    if (drag.mode === 'move') {
      el.style.transform = vertical ? `translateY(${px}px)` : `translateX(${px}px)`;
    } else {
      const base = (drag.origEnd - drag.origStart) / 60_000;
      const next = Math.max(step, base + snappedMin) * spec.pxPerMinute;
      if (vertical) el.style.height = `${next}px`;
      else el.style.width = `${next}px`;
    }
  }

  async function onPointerUp(e: React.PointerEvent) {
    if (!drag) return;
    const el = elRef.current[drag.id];
    const delta = (vertical ? e.clientY : e.clientX) - drag.startPx;
    const deltaMin = delta / spec.pxPerMinute;
    const b = blocks.find((x) => x.id === drag.id);
    const wasMoved = moved.current;
    const dropOnTrash = drag.mode === 'move' && wasMoved && !!overTrash(e);
    setDrag(null);
    moved.current = false;
    const trashEl = document.querySelector<HTMLElement>('[data-drop="trash"]');
    if (trashEl) trashEl.dataset.hover = 'false';
    if (el) el.dataset.trash = 'false';
    if (el) {
      // transform은 React가 안 쓰는 속성이라 지워도 되지만, height/width는 React 것이다.
      el.style.transform = '';
      el.style.height = drag.origStyle.height;
      el.style.width = drag.origStyle.width;
    }
    // 클릭은 선택만 한다. 여기서 저장하면 스냅이 걸려 시각이 최대 ±7.5분 조용히 움직인다.
    if (!b || !wasMoved) return;

    if (dropOnTrash) {
      await removeBlock(b.id); // 툼스톤. Task는 그대로 남아 리스트에 '미스케줄'로 돌아간다
      force((n) => n + 1);
      return;
    }

    if (drag.mode === 'move') {
      const start = snap(new Date(drag.origStart + deltaMin * 60_000), zoom, !snapDisabled);
      const dur = drag.origEnd - drag.origStart;
      await saveBlock({
        ...b,
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + dur).toISOString(),
      });
    } else {
      const end = snap(new Date(drag.origEnd + deltaMin * 60_000), zoom, !snapDisabled);
      const min = drag.origStart + spec.snapMinutes * 60_000;
      await saveBlock({
        ...b,
        end_at: new Date(Math.max(end.getTime(), min)).toISOString(),
      });
    }
    force((n) => n + 1);
  }

  // ── 인박스 → 타임라인 드롭: Block 생성 (3.2) ────────────────────────────
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/sigwan-task');
    if (!taskId || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = vertical
      ? e.clientY - rect.top + wrapRef.current.scrollTop
      : e.clientX - rect.left + wrapRef.current.scrollLeft - GUTTER;
    await scheduleTask(taskId, snap(pxToTime(px, origin, zoom), zoom, !snapDisabled));
  }

  const canvasStyle: React.CSSProperties = vertical
    ? { height: axisPx, paddingLeft: GUTTER, minWidth: GUTTER + laneCount * LANE_W + 20 }
    : { width: GUTTER + axisPx, height: Math.max(blocksTop + laneCount * (LANE_H + ROW_GAP) + 16, 220) };

  return (
    <>
      <div className="pane-head">
        <ZoomBar />
        <span className="nav">
          <button type="button" className="ghost-btn" onClick={() => shift(-1)} aria-label="이전">
            ◀
          </button>
          <button
            type="button"
            onClick={() => useStore.getState().setOrigin(startOfDay())}
            className="ghost-btn"
          >
            오늘 (T)
          </button>
          <button type="button" className="ghost-btn" onClick={() => shift(1)} aria-label="다음">
            ▶
          </button>
        </span>
        <span className="range-label">{rangeLabel(origin, zoom, spanMinutes)}</span>
        <span
          className="view-progress range-progress"
          title={`이 기간에 마감이 있는 할 일 — 완료 ${rangeProg.done} / 전체 ${rangeProg.total}`}
        >
          <span className="progress progress-inline">
            <span className="progress-bar" style={{ width: `${rangePct ?? 0}%` }} />
          </span>
          <span className="count pct">{rangePct === null ? '—' : `${rangePct}%`}</span>
        </span>
        {!vertical && (
          <span className="urg-legend" title="기간 막대 색 = 마감 임박도. 점수의 U와 같은 값">
            멀다 <i /> 급하다
          </span>
        )}
        {!vertical && <span className="readonly-note">읽기 전용 — 막대가 {Math.round(120 * spec.pxPerMinute)}px라 드래그 불가</span>}
        {vertical && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>Alt = 스냅 해제 · 막대 아래끝 = 길이 조절</span>}
      </div>

      <div
        className="tl-wrap"
        ref={wrapRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="tl-canvas" style={canvasStyle}>
          <div className="tl-gutter" />

          {dayColumns.map((c) => (
            <div
              key={c.left}
              className={`tl-daycol${c.weekend ? ' weekend' : ''}${c.today ? ' today' : ''}`}
              style={{ left: GUTTER + c.left, width: c.width }}
            />
          ))}

          {ghosts.placed.map(({ item, offset, size, lane }) => {
            const task = taskById.get(item.task_id as string);
            if (!task) return null;
            const urg = urgencyColor(priorityScore(task, now).urgency);
            if (!task.start_at) {
              // 마일스톤 — 마감 시각에 마름모
              return (
                <div
                  key={`m-${item.id}`}
                  className="milestone"
                  style={{
                    left: GUTTER + offset + size - 6,
                    top: HEAD_H + 6 + lane * (GHOST_H + 2) + 2,
                    background: urg,
                  }}
                  title={`${task.title}\n마감 ${fmtDay(item.end_at)}`}
                  onClick={() => revealTask(task.id)}
                />
              );
            }
            return (
              <div
                key={`g-${item.id}`}
                className="ghost"
                style={{
                  left: GUTTER + offset,
                  width: Math.max(size, 6),
                  top: HEAD_H + 6 + lane * (GHOST_H + 2),
                  height: GHOST_H,
                  borderColor: urg,
                  color: urg,
                  // 화면 왼쪽 밖에서 시작하는 막대는 라벨을 보이는 첫 지점으로 민다
                  paddingLeft: offset < 0 ? -offset + 8 : 8,
                }}
                title={`${task.title}\n기간 ${fmtDay(item.start_at)} → ${fmtDay(item.end_at)}`}
                onClick={() => revealTask(task.id)}
              >
                {size > 60 && <span className="ghost-label">{task.title}</span>}
              </div>
            );
          })}

          {tickList.map((t) => (
            <div
              key={t.t.getTime()}
              className={`tl-tick${t.major ? ' major' : ''}${vertical ? ' v' : ' h'}`}
              style={
                vertical
                  ? { top: t.offset, background: isWeekend(t.t) ? 'var(--weekend)' : undefined }
                  : {
                      top: 0,
                      bottom: 0,
                      left: GUTTER + t.offset,
                      right: 'auto',
                      width: 1,
                      borderTop: 0,
                      borderLeft: `1px solid var(--${t.major ? 'border-strong' : 'border'})`,
                    }
              }
            >
              {t.major && <span className="tl-label">{t.label}</span>}
            </div>
          ))}

          {showNow && (
            <div
              className="tl-now"
              style={vertical ? { top: nowOffset } : { top: 0, bottom: 0, left: GUTTER + nowOffset, right: 'auto', width: 0, height: 'auto', borderTop: 0, borderLeft: '2px solid var(--now-line)' }}
            >
              {vertical && <span className="tl-now-label">{nowLabel}</span>}
            </div>
          )}

          {placed.map(({ item, offset, size, lane }) => {
            const task = item.task_id ? taskById.get(item.task_id) : undefined;
            const grade = task ? priorityScore(task).grade : 'later';
            // 등급 '여유'(#8b8d98)와 순수 일정 회색이 화면에서 구분이 안 된다.
            // 일정은 "할 일이 아닌 것"이므로 색이 아니라 형태로 가른다 — 점선 테두리 + 투명 배경.
            const isEvent = !task;
            const color = task ? GRADE_COLOR[grade] : 'transparent';
            const out = task ? isOutOfRange(item, task.due_at) : false;
            const eventStyle: React.CSSProperties = isEvent
              ? {
                  border: '1px dashed var(--border-strong)',
                  color: 'var(--text-dim)',
                  background: 'var(--bg-panel)',
                  boxShadow: 'none',
                }
              : {};
            const style: React.CSSProperties = vertical
              ? { top: offset, height: Math.max(size, 14), left: GUTTER + 6 + lane * LANE_W, width: LANE_W - 10, background: color, ...eventStyle }
              : { left: GUTTER + offset, width: Math.max(size, 3), top: blocksTop + lane * (LANE_H + ROW_GAP), height: LANE_H, background: color, ...eventStyle };
            return (
              <div
                key={item.id}
                ref={(el) => {
                  elRef.current[item.id] = el;
                }}
                className="block"
                data-dragging={drag?.id === item.id}
                data-out={out}
                style={style}
                title={`${task?.title ?? item.title ?? ''}\n${fmt(item.start_at)} – ${fmt(item.end_at)}`}
                onPointerDown={(e) => onPointerDown(e, item, 'move')}
                onClick={() => item.task_id && revealTask(item.task_id)}
              >
                {task?.title ?? item.title}
                {vertical && size > 30 && (
                  <div style={{ opacity: 0.8, fontSize: 10 }}>{fmt(item.start_at)}</div>
                )}
                {vertical && (
                  <div className="handle" onPointerDown={(e) => onPointerDown(e, item, 'resize')} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ZoomBar() {
  const { zoom, setZoom } = useStore();
  return (
    <div className="zoombar">
      {(['day', 'week', 'month', 'quarter'] as const).map((z, i) => (
        <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>
          {ZOOMS[z].label} {i + 1}
        </button>
      ))}
    </div>
  );
}

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 기간 막대 색 — 등급 4단계가 아니라 임박도(U, 0~100)를 그대로 쓴다.
 * 멀면 옅은 회색, 다가올수록 붉고 진해진다. U는 점수 공식의 그 U라
 * 리스트 순서와 막대 색이 같은 숫자에서 나온다.
 */
function urgencyColor(u: number): string {
  const pct = Math.round(Math.min(100, Math.max(0, u)));
  return `color-mix(in oklab, var(--grade-now) ${pct}%, var(--border-strong))`;
}

function fmtDay(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function rangeLabel(origin: Date, zoom: ZoomLevel, spanMinutes: number) {
  const end = new Date(origin.getTime() + spanMinutes * 60_000 - 1);
  const f = (d: Date) => d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: zoom === 'day' ? 'short' : undefined });
  return zoom === 'day' ? f(origin) : `${f(origin)} – ${f(end)}`;
}

function fmt(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

import type * as React from 'react';
import type { Block } from '@sigwan/core';
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

  const tickList = useMemo(() => ticks(origin, axisPx, zoom), [origin, axisPx, zoom]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const nowOffset = timeToPx(new Date(), origin, zoom);
  const showNow = nowOffset >= 0 && nowOffset <= axisPx;

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
    : { width: GUTTER + axisPx, height: Math.max(laneCount * (LANE_H + ROW_GAP) + 48, 200) };

  return (
    <>
      <div className="pane-head">
        <ZoomBar />
        <button
          type="button"
          onClick={() => useStore.getState().setOrigin(startOfDay())}
          className="ghost-btn"
        >
          오늘 (T)
        </button>
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

          {tickList.map((t) => (
            <div
              key={t.t.getTime()}
              className={`tl-tick${t.major ? ' major' : ''}`}
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
              {(t.major || zoom === 'day') && <span>{t.label}</span>}
            </div>
          ))}

          {showNow && (
            <div
              className="tl-now"
              style={vertical ? { top: nowOffset } : { top: 0, bottom: 0, left: GUTTER + nowOffset, right: 'auto', width: 0, height: 'auto', borderTop: 0, borderLeft: '2px solid var(--now-line)' }}
            />
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
              : { left: GUTTER + offset, width: Math.max(size, 3), top: 40 + lane * (LANE_H + ROW_GAP), height: LANE_H, background: color, ...eventStyle };
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

function fmt(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

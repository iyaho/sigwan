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

type DragState =
  | { mode: 'move'; id: string; startPx: number; origStart: number; origEnd: number }
  | { mode: 'resize'; id: string; startPx: number; origStart: number; origEnd: number }
  | null;

export function Timeline() {
  const { zoom, origin, blocks, tasks, snapDisabled, saveBlock, scheduleTask, select } = useStore();
  const spec = ZOOMS[zoom];
  const vertical = spec.vertical;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>(null);
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
    setDrag({
      mode,
      id: b.id,
      startPx: vertical ? e.clientY : e.clientX,
      origStart: Date.parse(b.start_at),
      origEnd: Date.parse(b.end_at),
    });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const el = elRef.current[drag.id];
    if (!el) return;
    const delta = (vertical ? e.clientY : e.clientX) - drag.startPx;
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
    setDrag(null);
    if (el) {
      el.style.transform = '';
      el.style.height = '';
      el.style.width = '';
    }
    if (!b) return;

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
                onClick={() => item.task_id && select(item.task_id)}
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

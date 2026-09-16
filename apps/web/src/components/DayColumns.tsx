import type * as React from 'react';
import type { Block, Task } from '@sigwan/core';
import { addDays, checkKey, DAY_MS, GRADE_COLOR, isOutOfRange, isWeekend, layoutBlocks, MIN_DRAGGABLE_PX, priorityScore, pxToTime, routineOccurrences, sameDay, sleepSpans, snap, ticks, timeToPx, WEEKDAY_KO, ymd, ZOOMS } from '@sigwan/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { urgencyColor } from '../lib/urgency';
import { useStore } from '../store';

/**
 * 모듈 ① 타임라인 엔진 — 세로 하루 열을 N개 나란히 (일 뷰 = 1열, 주 뷰 = 월~일 7열).
 *
 * 지켜야 하는 것 셋:
 *  1. 좌표는 core의 timeToPx/pxToTime만 쓴다. 컴포넌트에서 직접 계산하지 않는다.
 *  2. 드래그 중에는 transform만 바꾸고 state를 건드리지 않는다 (리렌더 = 끊김).
 *  3. 저장은 포인터를 뗄 때 한 번. DB에는 스냅되지 않은 정확한 값이 들어간다.
 *
 * 주 뷰가 가로 간트였을 때는 2시간 막대가 4.8px라 읽기 전용이었다. 세로 열로 세우니
 * 일 뷰와 같은 72px/시간이라 그대로 끌 수 있다 — 열 사이를 건너뛰면 날짜가 바뀐다.
 */

const V = ZOOMS.day; // 세로 축 스케일은 일·주 모두 같다
const GUTTER = 52;
const HEAD_H = 34; // 요일·날짜 헤더
const DUE_ROW_MIN = 26; // 그 날 마감 칩 줄
const AXIS_PX = 1440 * V.pxPerMinute;
const DRAG_THRESHOLD_PX = 3;

interface DragState {
  mode: 'move' | 'resize';
  id: string;
  startX: number;
  startY: number;
  origStart: number;
  origEnd: number;
  /** 되돌리기용. ''로 지우면 React가 다시 안 써서 막대가 쪼그라든다 */
  origStyle: { height: string; transform: string };
}

export function DayColumns({ start, days }: { start: Date; days: number }) {
  const {
    blocks,
    tasks,
    routines,
    routineChecks,
    settings,
    snapDisabled,
    saveBlock,
    removeBlock,
    scheduleTask,
    revealTask,
    toggleRoutineCheck,
    proposals,
    editProposal,
    dropProposal,
  } = useStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const moved = useRef(false);
  const [, force] = useState(0);
  const [colW, setColW] = useState(200);

  // 열 폭 = (컨테이너 − 거터) / 일수. 창 크기 바뀌면 다시 잰다.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setColW(Math.max(120, (el.clientWidth - GUTTER) / days));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [days]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => useStore.getState().setSnapDisabled(e.altKey);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
    };
  }, []);

  const dayStarts = useMemo(() => Array.from({ length: days }, (_, i) => addDays(start, i)), [start, days]);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  /**
   * 제안을 Block 모양으로 감싼다. id에 'p:'를 붙여 구분하고, 저장하는 지점에서만 갈라낸다.
   * 이렇게 해야 레인 계산·드래그·길이 조절·휴지통 드롭이 전부 공짜로 따라온다.
   */
  const proposalBlocks = useMemo<Block[]>(
    () =>
      proposals.map((p) => ({
        id: `p:${p.key}`,
        user_id: 'local-user',
        task_id: p.taskId,
        title: p.title,
        start_at: p.start,
        end_at: p.end,
        is_all_day: false,
        source: 'drag',
        deleted_at: null,
        rev: 0,
      })),
    [proposals],
  );
  const allBlocks = useMemo(() => [...blocks, ...proposalBlocks], [blocks, proposalBlocks]);

  /** 열마다 레인 배치 — 하루 안에서만 겹침을 푼다 */
  const columns = useMemo(
    () =>
      dayStarts.map((d0) => {
        const d1 = addDays(d0, 1);
        const vis = allBlocks.filter(
          (b) => !b.deleted_at && Date.parse(b.end_at) > d0.getTime() && Date.parse(b.start_at) < d1.getTime(),
        );
        return layoutBlocks(vis, d0, 'day');
      }),
    [allBlocks, dayStarts],
  );

  /** 그 날 마감인 할 일 (열린 것만) — 상단 칩 */
  const dueByDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.deleted_at || t.status === 'done' || t.kind === 'someday') continue;
      const key = t.due_at ? ymd(new Date(t.due_at)) : t.day_of;
      if (!key) continue;
      (m.get(key) ?? m.set(key, []).get(key))?.push(t);
    }
    return m;
  }, [tasks]);
  const dueRowH = Math.max(
    DUE_ROW_MIN,
    Math.max(0, ...dayStarts.map((d) => (dueByDay.get(ymd(d))?.length ?? 0))) * 20 + 8,
  );
  const topH = HEAD_H + dueRowH;

  /**
   * 막혀 있는 시간 — 수면과 고정 일정. 배경으로 깐다.
   * layoutBlocks에 넣으면 8시간짜리 수면이 레인을 하나 먹어서 진짜 블록이 절반 폭이 된다.
   */
  const busyByDay = useMemo(() => {
    const end = addDays(start, days);
    const occ = routineOccurrences(routines, start, end);
    const sleeps = sleepSpans(settings.sleep, start, end);
    return dayStarts.map((d0) => {
      const d1 = addDays(d0, 1);
      const within = (s: Date, e: Date) => e.getTime() > d0.getTime() && s.getTime() < d1.getTime();
      return {
        sleeps: sleeps
          .filter((b) => within(new Date(b.start_at), new Date(b.end_at)))
          .map((b) => ({
            id: b.id,
            top: Math.max(0, timeToPx(new Date(b.start_at), d0, 'day')),
            bottom: Math.min(AXIS_PX, timeToPx(new Date(b.end_at), d0, 'day')),
          }))
          .filter((x) => x.bottom > x.top),
        routines: occ
          .filter((o) => within(o.start, o.end))
          .map((o) => ({
            o,
            top: Math.max(0, timeToPx(o.start, d0, 'day')),
            bottom: Math.min(AXIS_PX, timeToPx(o.end, d0, 'day')),
          }))
          .filter((x) => x.bottom > x.top),
      };
    });
  }, [routines, settings.sleep, dayStarts, start, days]);

  const tickList = useMemo(() => ticks(start, AXIS_PX, 'day'), [start]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const todayIdx = dayStarts.findIndex((d) => sameDay(d, now));
  const nowY = todayIdx >= 0 ? timeToPx(now, dayStarts[todayIdx] as Date, 'day') : -1;
  const nowLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 처음엔 지금 시각(오늘이 없으면 09:00)이 위쪽에 오게
  const scrolled = useRef<string>('');
  useEffect(() => {
    const el = wrapRef.current;
    const key = `${ymd(start)}-${days}`;
    if (!el || scrolled.current === key) return;
    scrolled.current = key;
    const y = todayIdx >= 0 ? nowY : 9 * 60 * V.pxPerMinute;
    el.scrollTop = Math.max(0, y - 120);
  }, [start, days, todayIdx, nowY]);

  // ── 드래그 ─────────────────────────────────────────────────────────
  const elRef = useRef<Record<string, HTMLDivElement | null>>({});

  function onPointerDown(e: React.PointerEvent, b: Block, mode: 'move' | 'resize') {
    const dur = (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000;
    if (dur * V.pxPerMinute < MIN_DRAGGABLE_PX) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const el = elRef.current[b.id];
    moved.current = false;
    setDrag({
      mode,
      id: b.id,
      startX: e.clientX,
      startY: e.clientY,
      origStart: Date.parse(b.start_at),
      origEnd: Date.parse(b.end_at),
      origStyle: { height: el?.style.height ?? '', transform: el?.style.transform ?? '' },
    });
  }

  function overTrash(e: { clientX: number; clientY: number }) {
    const el = document.querySelector<HTMLElement>('[data-drop="trash"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? el : null;
  }

  /** 포인터 이동 → (날짜 칸 이동, 스냅된 분) */
  function deltaOf(e: { clientX: number; clientY: number }, d: DragState) {
    const dy = e.clientY - d.startY;
    const dx = e.clientX - d.startX;
    const step = snapDisabled ? 1 : V.snapMinutes;
    const minutes = Math.round(dy / V.pxPerMinute / step) * step;
    const dayShift = d.mode === 'move' && days > 1 ? Math.round(dx / colW) : 0;
    return { minutes, dayShift, movedPx: Math.max(Math.abs(dx), Math.abs(dy)) };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const el = elRef.current[drag.id];
    if (!el) return;
    const { minutes, dayShift, movedPx } = deltaOf(e, drag);
    if (movedPx >= DRAG_THRESHOLD_PX) moved.current = true;
    if (drag.mode === 'move') {
      const trash = document.querySelector<HTMLElement>('[data-drop="trash"]');
      const hit = overTrash(e);
      if (trash) trash.dataset.hover = hit ? 'true' : 'false';
      el.dataset.trash = hit ? 'true' : 'false';
      el.style.transform = `translate(${dayShift * colW}px, ${minutes * V.pxPerMinute}px)`;
    } else {
      const base = (drag.origEnd - drag.origStart) / 60_000;
      const step = snapDisabled ? 1 : V.snapMinutes;
      el.style.height = `${Math.max(step, base + minutes) * V.pxPerMinute}px`;
    }
  }

  async function onPointerUp(e: React.PointerEvent) {
    if (!drag) return;
    const el = elRef.current[drag.id];
    const { minutes, dayShift } = deltaOf(e, drag);
    const b = allBlocks.find((x) => x.id === drag.id);
    const wasMoved = moved.current;
    const dropOnTrash = drag.mode === 'move' && wasMoved && !!overTrash(e);
    setDrag(null);
    moved.current = false;
    const trashEl = document.querySelector<HTMLElement>('[data-drop="trash"]');
    if (trashEl) trashEl.dataset.hover = 'false';
    if (el) {
      el.dataset.trash = 'false';
      el.style.transform = drag.origStyle.transform;
      el.style.height = drag.origStyle.height;
    }
    if (!b || !wasMoved) return; // 클릭은 선택만. 저장하면 스냅으로 시각이 조용히 움직인다

    // 제안은 아직 DB에 없다. 여기서 저장하면 「적용」 버튼의 의미가 사라진다.
    if (isProposal(b.id)) {
      const key = b.id.slice(2);
      if (dropOnTrash) {
        dropProposal(key);
        return;
      }
      if (drag.mode === 'move') {
        const s2 = new Date(drag.origStart + dayShift * DAY_MS + minutes * 60_000);
        editProposal(key, { start: snapDisabled ? s2 : snap(s2, 'day') });
      } else {
        const e2 = new Date(drag.origEnd + minutes * 60_000);
        const endAt = snapDisabled ? e2 : snap(e2, 'day');
        const min = drag.origStart + V.snapMinutes * 60_000;
        editProposal(key, { end: new Date(Math.max(endAt.getTime(), min)) });
      }
      force((n) => n + 1);
      return;
    }

    if (dropOnTrash) {
      await removeBlock(b.id);
      force((n) => n + 1);
      return;
    }
    if (drag.mode === 'move') {
      const s = new Date(drag.origStart + dayShift * DAY_MS + minutes * 60_000);
      const startAt = snapDisabled ? s : snap(s, 'day');
      await saveBlock({
        ...b,
        start_at: startAt.toISOString(),
        end_at: new Date(startAt.getTime() + (drag.origEnd - drag.origStart)).toISOString(),
      });
    } else {
      const e2 = new Date(drag.origEnd + minutes * 60_000);
      const endAt = snapDisabled ? e2 : snap(e2, 'day');
      const min = drag.origStart + V.snapMinutes * 60_000;
      await saveBlock({ ...b, end_at: new Date(Math.max(endAt.getTime(), min)).toISOString() });
    }
    force((n) => n + 1);
  }

  // ── 인박스 → 열 드롭 = Block 생성 ────────────────────────────────
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/sigwan-task');
    const el = wrapRef.current;
    if (!taskId || !el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left + el.scrollLeft - GUTTER;
    const idx = Math.min(days - 1, Math.max(0, Math.floor(x / colW)));
    const y = e.clientY - r.top + el.scrollTop - topH;
    const t = pxToTime(y, dayStarts[idx] as Date, 'day');
    await scheduleTask(taskId, snapDisabled ? t : snap(t, 'day'));
  }

  return (
    <div
      className="tl-wrap cols-wrap"
      ref={wrapRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="cols-canvas" style={{ height: topH + AXIS_PX, minWidth: GUTTER + days * 120 }}>
        {/* 상단 고정: 요일 헤더 + 마감 칩 줄 */}
        <div className="cols-top" style={{ height: topH, paddingLeft: GUTTER }}>
          {dayStarts.map((d, i) => {
            const due = dueByDay.get(ymd(d)) ?? [];
            const today = sameDay(d, now);
            return (
              <div
                key={ymd(d)}
                className={`col-head${today ? ' today' : ''}${isWeekend(d) ? ' weekend' : ''}`}
                style={{ width: colW }}
              >
                <button
                  type="button"
                  className="col-date"
                  onClick={() => {
                    useStore.getState().setOrigin(d);
                    useStore.getState().setZoom('day');
                  }}
                  title="이 날만 보기"
                >
                  <span className="col-dow">{WEEKDAY_KO[(d.getDay() + 6) % 7]}</span>
                  <span className="col-num">{d.getDate()}</span>
                </button>
                <div className="due-chips" style={{ height: dueRowH }}>
                  {due.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="due-chip"
                      style={{ borderColor: urgencyColor(priorityScore(t, now).urgency) }}
                      title={`${t.title} — 마감`}
                      onClick={() => revealTask(t.id)}
                    >
                      <i style={{ background: urgencyColor(priorityScore(t, now).urgency) }} />
                      {t.title}
                    </button>
                  ))}
                </div>
                {i > 0 && <span className="col-sep" />}
              </div>
            );
          })}
        </div>

        {/* 시간축 */}
        <div className="cols-body" style={{ top: topH, height: AXIS_PX }}>
          <div className="tl-gutter" />
          {tickList.map((t) => (
            <div
              key={t.t.getTime()}
              className={`tl-tick v${t.major ? ' major' : ''}`}
              style={{ top: t.offset }}
            >
              {t.major && <span className="tl-label">{t.label}</span>}
            </div>
          ))}

          {dayStarts.map((d, i) => {
            const { placed, laneCount } = columns[i] as ReturnType<typeof layoutBlocks>;
            const left = GUTTER + i * colW;
            const laneW = (colW - 8) / Math.max(1, laneCount);
            const today = sameDay(d, now);
            return (
              <div
                key={ymd(d)}
                className={`day-col${today ? ' today' : ''}${isWeekend(d) ? ' weekend' : ''}`}
                style={{ left, width: colW }}
              >
                {/* 수면 — 보여주기만 한다 */}
                {busyByDay[i]?.sleeps.map((sl) => (
                  <div key={sl.id} className="col-sleep" style={{ top: sl.top, height: sl.bottom - sl.top }} />
                ))}

                {/* 고정 일정 — 체크는 여기서 한다. 띠 자체는 클릭을 먹지 않는다 (드래그 방해 금지) */}
                {busyByDay[i]?.routines.map(({ o, top, bottom }) => {
                  const done = !!routineChecks[checkKey(o.routine.id, o.day)];
                  const future = o.day > ymd(now);
                  return (
                    <div
                      key={`${o.routine.id}:${o.day}`}
                      className="col-routine"
                      data-done={done}
                      style={{ top, height: bottom - top, borderColor: o.routine.color }}
                    >
                      <button
                        type="button"
                        className="rc-check"
                        disabled={future}
                        aria-pressed={done}
                        title={future ? '아직 오지 않은 날이다' : done ? '체크 해제' : '했다고 표시'}
                        style={done ? { background: o.routine.color, borderColor: o.routine.color } : undefined}
                        onClick={() => void toggleRoutineCheck(o.routine.id, o.day)}
                      >
                        {done ? '✓' : ''}
                      </button>
                      <span className="rc-name" style={{ color: o.routine.color }}>
                        {o.routine.name}
                      </span>
                    </div>
                  );
                })}

                {today && (
                  <div className="tl-now col-now" style={{ top: nowY }}>
                    {i === 0 && <span className="tl-now-label">{nowLabel}</span>}
                  </div>
                )}
                {placed.map(({ item, offset, size, lane }) => {
                  const prop = isProposal(item.id);
                  const task = item.task_id ? taskById.get(item.task_id) : undefined;
                  const isEvent = !task && !prop;
                  const color = task ? GRADE_COLOR[priorityScore(task, now).grade] : 'transparent';
                  const out = task ? isOutOfRange(item, task.due_at) : false;
                  const eventStyle: React.CSSProperties = isEvent
                    ? { border: '1px dashed var(--border-strong)', color: 'var(--text-dim)', background: 'var(--bg-panel)', boxShadow: 'none' }
                    : {};
                  return (
                    <div
                      key={item.id}
                      ref={(el) => {
                        elRef.current[item.id] = el;
                      }}
                      className={`block${prop ? ' block-proposal' : ''}`}
                      data-dragging={drag?.id === item.id}
                      data-out={out}
                      style={{
                        top: offset,
                        height: Math.max(size, 14),
                        left: 4 + lane * laneW,
                        width: laneW - 3,
                        background: color,
                        ...eventStyle,
                      }}
                      title={`${prop ? '제안 · ' : ''}${task?.title ?? item.title ?? ''}\n${fmt(item.start_at)} – ${fmt(item.end_at)}`}
                      onPointerDown={(e) => onPointerDown(e, item, 'move')}
                      onClick={() => item.task_id && revealTask(item.task_id)}
                    >
                      {task?.title ?? item.title}
                      {size > 30 && <div style={{ opacity: 0.8, fontSize: 10 }}>{fmt(item.start_at)}</div>}
                      <div className="handle" onPointerDown={(e) => onPointerDown(e, item, 'resize')} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 제안 블록은 id가 'p:'로 시작한다. 진짜 Block과 섞이지 않게 한 곳에서만 판별한다 */
const isProposal = (id: string) => id.startsWith('p:');

function fmt(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}


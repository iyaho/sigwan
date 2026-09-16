import type * as React from 'react';
import type { Task } from '@sigwan/core';
import { priorityScore } from '@sigwan/core';
import { useEffect, useMemo, useState } from 'react';
import { DAY_MS, WEEKDAY_KO, addDays, monthGrid, sameDay, startOfDay, ymd } from '../lib/calendar';
import { urgencyColor } from '../lib/urgency';
import { useStore } from '../store';

/**
 * 월 뷰 — 달력 격자 위에 기간 막대.
 *
 * 규칙 셋:
 *  1. 이틀 이상 걸치는 것만 막대. 하루짜리는 칸 안에 '+n'으로 접는다
 *  2. 마감이 같은 것들은 막대 하나로 묶는다 ("발표자료 외 2") — 시작이 달라도. 막대는 가장 이른 시작부터
 *  3. 접힌 것·묶인 것은 누르면 바로 아래 팝업으로 펼친다
 *
 * 시작일이 없으면 오늘~마감 — 점수의 slack이 재는 남은 창. 그래서 같은 마감의
 * 할 일들이 자연스럽게 한 막대로 묶인다.
 */

const DAY_ROW = 28;
const BAR_H = 18;
const BAR_H_COMPACT = 6;
const BAR_GAP = 2;
const MAX_LANES = 8;
const MAX_LANES_COMPACT = 4;

interface Group {
  key: string;
  s: Date;
  e: Date;
  tasks: Task[];
  u: number; // 가장 급한 것의 임박도
}
interface Seg {
  g: Group;
  lane: number;
  col0: number;
  col1: number;
  startsHere: boolean;
  endsHere: boolean;
}
interface Pop {
  title: string;
  tasks: Task[];
  x: number;
  y: number;
  /** 아래 공간이 모자라면 위로 연다 */
  up: boolean;
}
const POP_W = 340;
const POP_MAX_H = 320;

export function MonthGrid({ monthStart, compact = false }: { monthStart: Date; compact?: boolean }) {
  const { tasks, blocks, revealTask, scheduleTask, setOrigin, setZoom } = useStore();
  const weeks = useMemo(() => monthGrid(monthStart), [monthStart]);
  const now = new Date();
  const today = startOfDay(now);
  const barH = compact ? BAR_H_COMPACT : BAR_H;
  const [pop, setPop] = useState<Pop | null>(null);

  useEffect(() => {
    if (!pop) return;
    const close = (e: Event) => {
      if ((e.target as Element).closest?.('.mpop')) return;
      setPop(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPop(null);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', esc);
    };
  }, [pop]);

  /** 같은 [시작, 마감] 끼리 묶는다. 하루짜리는 singles로 */
  const { groups, singles } = useMemo(() => {
    const gm = new Map<string, Group>();
    const sm = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.deleted_at || t.status === 'done' || t.kind === 'someday' || !(t.due_at || t.day_of)) continue;
      const e = startOfDay(t.due_at ? new Date(t.due_at) : new Date(`${t.day_of}T12:00:00`));
      const s0 = t.start_at ? startOfDay(new Date(t.start_at)) : today;
      const s = s0.getTime() > e.getTime() ? e : s0;
      const u = priorityScore(t, now).urgency;
      if (s.getTime() === e.getTime()) {
        const k = ymd(e);
        (sm.get(k) ?? sm.set(k, []).get(k))?.push(t);
        continue;
      }
      // 묶는 기준은 마감 하나. 시작이 달라도 같은 마감이면 한 막대 — 막대는 가장 이른 시작부터
      const key = ymd(e);
      const g = gm.get(key);
      if (g) {
        g.tasks.push(t);
        g.u = Math.max(g.u, u);
        if (s.getTime() < g.s.getTime()) g.s = s;
      } else gm.set(key, { key, s, e, tasks: [t], u });
    }
    for (const g of gm.values()) g.tasks.sort((a, b) => priorityScore(b, now).score - priorityScore(a, now).score);
    for (const l of sm.values()) l.sort((a, b) => priorityScore(b, now).score - priorityScore(a, now).score);
    const groups = [...gm.values()].sort(
      (a, b) => a.s.getTime() - b.s.getTime() || a.e.getTime() - b.e.getTime(),
    );
    return { groups, singles: sm };
  }, [tasks, today, now]);

  const rows = useMemo(
    () =>
      weeks.map((week) => {
        const w0 = week[0] as Date;
        const w1 = addDays(w0, 7);
        const laneEnd: number[] = [];
        const segs: Seg[] = [];
        for (const g of groups) {
          if (g.e.getTime() < w0.getTime() || g.s.getTime() >= w1.getTime()) continue;
          const col0 = Math.max(0, Math.round((g.s.getTime() - w0.getTime()) / DAY_MS));
          const col1 = Math.min(6, Math.round((g.e.getTime() - w0.getTime()) / DAY_MS));
          let lane = laneEnd.findIndex((end) => end < col0);
          if (lane === -1) {
            lane = laneEnd.length;
            laneEnd.push(col1);
          } else laneEnd[lane] = col1;
          segs.push({ g, lane, col0, col1, startsHere: g.s.getTime() >= w0.getTime(), endsHere: g.e.getTime() < w1.getTime() });
        }
        return { week, segs, lanes: laneEnd.length };
      }),
    [weeks, groups],
  );

  const blocksByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of blocks) {
      if (b.deleted_at) continue;
      const k = ymd(new Date(b.start_at));
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [blocks]);

  const openDay = (d: Date) => {
    setOrigin(d);
    setZoom('day');
  };
  const openPop = (e: React.MouseEvent, title: string, list: Task[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // 오른쪽 끝 칸에서 열면 화면 밖으로 나가 잘린다 — 앵커의 오른쪽 끝에 맞춰 왼쪽으로 연다
    let x = r.left;
    if (x + POP_W > window.innerWidth - 8) x = Math.max(8, r.right - POP_W);
    const up = r.bottom + 4 + POP_MAX_H > window.innerHeight && r.top > POP_MAX_H;
    setPop({ title, tasks: list, x, y: up ? r.top - 4 : r.bottom + 4, up });
  };

  return (
    <div className={`mgrid${compact ? ' compact' : ''}`}>
      {compact && <div className="mgrid-title">{monthStart.toLocaleDateString('ko-KR', { month: 'long' })}</div>}
      <div className="mgrid-dow">
        {WEEKDAY_KO.map((w, i) => (
          <span key={w} className={i >= 5 ? 'weekend' : ''}>
            {w}
          </span>
        ))}
      </div>

      {rows.map(({ week, segs, lanes }) => {
        const maxLanes = compact ? MAX_LANES_COMPACT : MAX_LANES;
        const shownLanes = Math.min(lanes, maxLanes);
        const hiddenGroups = segs.filter((sg) => sg.lane >= maxLanes);
        const hidden = hiddenGroups.reduce((n, sg) => n + sg.g.tasks.length, 0);
        const barsH = shownLanes * (barH + BAR_GAP) + (hidden ? (compact ? 10 : 18) : 0);
        const minH = DAY_ROW + barsH + (compact ? 6 : 26);
        return (
          <div key={ymd(week[0] as Date)} className="mgrid-week" style={{ minHeight: minH }}>
            {week.map((d) => {
              const key = ymd(d);
              const inMonth = d.getMonth() === monthStart.getMonth();
              const nBlocks = blocksByDay.get(key) ?? 0;
              const short = singles.get(key) ?? [];
              const isToday = sameDay(d, now);
              const wk = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div
                  key={key}
                  className={`mcell${inMonth ? '' : ' out'}${isToday ? ' today' : ''}${wk ? ' weekend' : ''}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/sigwan-task');
                    if (!id) return;
                    const at = new Date(d);
                    at.setHours(9, 0, 0, 0);
                    await scheduleTask(id, at);
                  }}
                >
                  <div className="mcell-top">
                    <button type="button" className="mcell-day" onClick={() => openDay(d)} title="이 날 보기">
                      {d.getDate()}
                    </button>
                    {short.length > 0 && (
                      <button
                        type="button"
                        className="mshort"
                        style={{ borderColor: urgencyColor(priorityScore(short[0] as Task, now).urgency) }}
                        title={short.map((t) => t.title).join('\n')}
                        onClick={(e) => openPop(e, `${d.getMonth() + 1}/${d.getDate()} 하루짜리`, short)}
                      >
                        +{short.length}
                      </button>
                    )}
                  </div>
                  {!compact && nBlocks > 0 && (
                    <span className="mcell-blocks" style={{ marginTop: barsH + 2 }} title={`블록 ${nBlocks}개`}>
                      ▮ {nBlocks}
                    </span>
                  )}
                </div>
              );
            })}

            {hidden > 0 && (
              <button
                type="button"
                className="mbar-more"
                style={{ top: DAY_ROW + shownLanes * (barH + BAR_GAP) }}
                onClick={(e) => openPop(e, '이 주의 나머지', hiddenGroups.flatMap((sg) => sg.g.tasks))}
              >
                +{hidden}
              </button>
            )}

            {segs
              .filter((sg) => sg.lane < maxLanes)
              .map((sg) => {
                const color = urgencyColor(sg.g.u);
                const n = sg.g.tasks.length;
                // tasks는 점수 내림차순 — 맨 앞이 가장 급한 것. 그게 제목이 된다
                const head = sg.g.tasks[0] as Task;
                const label = n > 1 ? `${head.title} 외 ${n - 1}개` : head.title;
                return (
                  <button
                    key={`${sg.g.key}-${sg.col0}`}
                    type="button"
                    className={`mbar${sg.startsHere ? ' s' : ''}${sg.endsHere ? ' e' : ''}${n > 1 ? ' grouped' : ''}`}
                    style={{
                      left: `calc(${(sg.col0 / 7) * 100}% + 2px)`,
                      width: `calc(${((sg.col1 - sg.col0 + 1) / 7) * 100}% - 4px)`,
                      top: DAY_ROW + sg.lane * (barH + BAR_GAP),
                      height: barH,
                      borderColor: color,
                      background: `color-mix(in oklab, ${color} 18%, var(--bg-panel))`,
                    }}
                    title={sg.g.tasks.map((t) => t.title).join('\n')}
                    onClick={(e) =>
                      n > 1 ? openPop(e, `${fmtD(sg.g.s)} → ${fmtD(sg.g.e)}`, sg.g.tasks) : revealTask(head.id)
                    }
                  >
                    {!compact && (
                      <span className={`mbar-label${sg.startsHere ? '' : ' mbar-cont'}`}>
                        {sg.startsHere ? '' : '… '}
                        {label}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        );
      })}

      {pop && (
        <div
          className="mpop"
          style={{ left: pop.x, top: pop.y, width: POP_W, transform: pop.up ? 'translateY(-100%)' : undefined }}
        >
          <div className="mpop-head">
            {pop.title} · {pop.tasks.length}
          </div>
          <ul>
            {pop.tasks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPop(null);
                    revealTask(t.id);
                  }}
                >
                  <i style={{ background: urgencyColor(priorityScore(t, now).urgency) }} />
                  <span className="mpop-title">{t.title}</span>
                  <span className="mpop-meta">{fmtDue(t)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const fmtD = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

function fmtDue(t: Task) {
  if (t.due_at) {
    const d = new Date(t.due_at);
    return `${fmtD(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return t.day_of ?? '';
}

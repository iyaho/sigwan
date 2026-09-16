import type { Task } from '@sigwan/core';
import { priorityScore } from '@sigwan/core';
import { useMemo } from 'react';
import { DAY_MS, WEEKDAY_KO, addDays, monthGrid, sameDay, startOfDay, ymd } from '../lib/calendar';
import { urgencyColor } from '../lib/urgency';
import { useStore } from '../store';

/**
 * 월 뷰 — 달력 격자 위에 기간 막대.
 *
 * 마감이 있는 할 일은 그 날 칩 하나가 아니라 시작~마감을 잇는 막대다(3.1 기간 막대).
 * 시작일이 없으면 "오늘부터 마감까지" — 점수의 slack이 재는 바로 그 남은 창이다.
 * 주가 바뀌면 막대가 다음 줄로 이어지고, 이어지는 쪽 끝은 각지게 둔다.
 *
 * `compact`는 분기 뷰 미니 달력 — 막대를 얇게, 글자 없이.
 */

const DAY_ROW = 28; // 날짜 숫자 줄
const BAR_H = 18;
const BAR_H_COMPACT = 6;
const BAR_GAP = 2;
/** 한 주에 보이는 막대 줄 수. 목 데이터로 27줄이 나왔다 — 그 이상은 '+n'으로 접고 주 뷰로 보낸다 */
const MAX_LANES = 8;
const MAX_LANES_COMPACT = 4;

interface Seg {
  task: Task;
  lane: number;
  col0: number; // 0~6
  col1: number;
  startsHere: boolean;
  endsHere: boolean;
  color: string;
}

export function MonthGrid({ monthStart, compact = false }: { monthStart: Date; compact?: boolean }) {
  const { tasks, blocks, revealTask, scheduleTask, setOrigin, setZoom } = useStore();
  const weeks = useMemo(() => monthGrid(monthStart), [monthStart]);
  const now = new Date();
  const today = startOfDay(now);
  const barH = compact ? BAR_H_COMPACT : BAR_H;

  /** 막대로 그릴 할 일: 열려 있고 마감이 있는 것. [s, e] 는 로컬 날짜(자정) */
  const spans = useMemo(() => {
    return tasks
      .filter((t) => !t.deleted_at && t.status !== 'done' && t.kind !== 'someday' && (t.due_at || t.day_of))
      .map((t) => {
        const e = startOfDay(t.due_at ? new Date(t.due_at) : new Date(`${t.day_of}T12:00:00`));
        const s0 = t.start_at ? startOfDay(new Date(t.start_at)) : today;
        const s = s0.getTime() > e.getTime() ? e : s0; // 마감이 지났으면 그 날 하나
        return { task: t, s, e, u: priorityScore(t, now).urgency };
      })
      .sort((a, b) => a.s.getTime() - b.s.getTime() || a.e.getTime() - b.e.getTime());
  }, [tasks, today, now]);

  /** 주 단위로 잘라 레인 배치 */
  const rows = useMemo(
    () =>
      weeks.map((week) => {
        const w0 = week[0] as Date;
        const w1 = addDays(w0, 7);
        const laneEnd: number[] = [];
        const segs: Seg[] = [];
        for (const sp of spans) {
          if (sp.e.getTime() < w0.getTime() || sp.s.getTime() >= w1.getTime()) continue;
          const col0 = Math.max(0, Math.round((sp.s.getTime() - w0.getTime()) / DAY_MS));
          const col1 = Math.min(6, Math.round((sp.e.getTime() - w0.getTime()) / DAY_MS));
          let lane = laneEnd.findIndex((end) => end < col0);
          if (lane === -1) {
            lane = laneEnd.length;
            laneEnd.push(col1);
          } else laneEnd[lane] = col1;
          segs.push({
            task: sp.task,
            lane,
            col0,
            col1,
            startsHere: sp.s.getTime() >= w0.getTime(),
            endsHere: sp.e.getTime() < w1.getTime(),
            color: urgencyColor(sp.u),
          });
        }
        return { week, segs, lanes: laneEnd.length };
      }),
    [weeks, spans],
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
        const hidden = new Set(segs.filter((sg) => sg.lane >= maxLanes).map((sg) => sg.task.id)).size;
        const barsH = shownLanes * (barH + BAR_GAP) + (hidden ? (compact ? 10 : 18) : 0);
        const minH = DAY_ROW + barsH + (compact ? 6 : 24);
        return (
          <div key={ymd(week[0] as Date)} className="mgrid-week" style={{ minHeight: minH }}>
            {week.map((d) => {
              const key = ymd(d);
              const inMonth = d.getMonth() === monthStart.getMonth();
              const nBlocks = blocksByDay.get(key) ?? 0;
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
                  <button type="button" className="mcell-day" onClick={() => openDay(d)} title="이 날 보기">
                    {d.getDate()}
                  </button>
                  {!compact && nBlocks > 0 && (
                    <span className="mcell-blocks" style={{ marginTop: barsH + 2 }} title={`블록 ${nBlocks}개`}>
                      ▮ {nBlocks}
                    </span>
                  )}
                </div>
              );
            })}

            {/* 기간 막대 — 주 줄 위에 절대 배치 */}
            {hidden > 0 && (
              <button
                type="button"
                className="mbar-more"
                style={{ top: DAY_ROW + shownLanes * (barH + BAR_GAP) }}
                title="이 주의 나머지 — 주 뷰에서 본다"
                onClick={() => {
                  setOrigin(week[0] as Date);
                  setZoom('week');
                }}
              >
                +{hidden}
              </button>
            )}
            {segs.filter((sg) => sg.lane < maxLanes).map((sg) => (
              <button
                key={`${sg.task.id}-${sg.col0}`}
                type="button"
                className={`mbar${sg.startsHere ? ' s' : ''}${sg.endsHere ? ' e' : ''}`}
                style={{
                  left: `calc(${(sg.col0 / 7) * 100}% + 2px)`,
                  width: `calc(${((sg.col1 - sg.col0 + 1) / 7) * 100}% - 4px)`,
                  top: DAY_ROW + sg.lane * (barH + BAR_GAP),
                  height: barH,
                  borderColor: sg.color,
                  background: `color-mix(in oklab, ${sg.color} 18%, var(--bg-panel))`,
                }}
                title={`${sg.task.title}\n${sg.task.start_at ? '기간' : '남은 기간'} → 마감 ${fmtDue(sg.task)}`}
                onClick={() => revealTask(sg.task.id)}
              >
                {!compact && sg.startsHere && <span className="mbar-label">{sg.task.title}</span>}
                {!compact && !sg.startsHere && <span className="mbar-label mbar-cont">… {sg.task.title}</span>}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function fmtDue(t: Task) {
  if (t.due_at) {
    const d = new Date(t.due_at);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return t.day_of ?? '';
}

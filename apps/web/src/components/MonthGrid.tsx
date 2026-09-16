import type { Task } from '@sigwan/core';
import { priorityScore } from '@sigwan/core';
import { useMemo } from 'react';
import { WEEKDAY_KO, monthGrid, sameDay, ymd } from '../lib/calendar';
import { urgencyColor } from '../lib/urgency';
import { useStore } from '../store';

/**
 * 월 뷰 — 달력 격자. 칸마다 그 날 마감인 할 일(임박도 색)과 블록 수.
 * 칸의 날짜를 누르면 그 날 일 뷰, 할 일을 끌어다 놓으면 09:00에 블록.
 * `compact`는 분기 뷰용 미니 달력 — 칩 대신 점.
 */
export function MonthGrid({ monthStart, compact = false }: { monthStart: Date; compact?: boolean }) {
  const { tasks, blocks, revealTask, scheduleTask, setOrigin, setZoom } = useStore();
  const weeks = useMemo(() => monthGrid(monthStart), [monthStart]);
  const now = new Date();

  const dueByDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.deleted_at || t.kind === 'someday') continue;
      const key = t.due_at ? ymd(new Date(t.due_at)) : t.day_of;
      if (!key) continue;
      (m.get(key) ?? m.set(key, []).get(key))?.push(t);
    }
    for (const list of m.values()) list.sort((a, b) => priorityScore(b, now).score - priorityScore(a, now).score);
    return m;
  }, [tasks, now]);

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
      {compact && (
        <div className="mgrid-title">
          {monthStart.toLocaleDateString('ko-KR', { month: 'long' })}
        </div>
      )}
      <div className="mgrid-dow">
        {WEEKDAY_KO.map((w, i) => (
          <span key={w} className={i >= 5 ? 'weekend' : ''}>
            {w}
          </span>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={ymd(week[0] as Date)} className="mgrid-week">
          {week.map((d) => {
            const inMonth = d.getMonth() === monthStart.getMonth();
            const key = ymd(d);
            const due = dueByDay.get(key) ?? [];
            const open = due.filter((t) => t.status !== 'done');
            const nBlocks = blocksByDay.get(key) ?? 0;
            const today = sameDay(d, now);
            const wk = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div
                key={key}
                className={`mcell${inMonth ? '' : ' out'}${today ? ' today' : ''}${wk ? ' weekend' : ''}`}
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
                {compact ? (
                  open.length > 0 && (
                    <span
                      className="mdots"
                      title={open.map((t) => t.title).join('\n')}
                      style={{ background: urgencyColor(priorityScore(open[0] as Task, now).urgency) }}
                    >
                      {open.length > 1 ? open.length : ''}
                    </span>
                  )
                ) : (
                  <div className="mcell-body">
                    {open.slice(0, 3).map((t) => {
                      const u = urgencyColor(priorityScore(t, now).urgency);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className="due-chip"
                          style={{ borderColor: u }}
                          title={t.title}
                          onClick={() => revealTask(t.id)}
                        >
                          <i style={{ background: u }} />
                          {t.title}
                        </button>
                      );
                    })}
                    {open.length > 3 && (
                      <button type="button" className="mcell-more" onClick={() => openDay(d)}>
                        +{open.length - 3}
                      </button>
                    )}
                    {nBlocks > 0 && (
                      <span className="mcell-blocks" title={`블록 ${nBlocks}개`}>
                        ▮ {nBlocks}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

import { WEEKDAY_KO, ymd } from '@sigwan/core';
import { useMemo } from 'react';
import { useStore } from '../store';

/**
 * 3.8 자동 배치 검토 — 제안을 보고, 고치고, 적용한다.
 *
 * 이 패널의 무게중심은 위쪽 제안 목록이 아니라 아래쪽 **「안 들어간 것」**이다.
 * 자동 배치의 쓸모는 시간을 채워주는 데 있지 않고 "이번 주엔 다 못 한다"를
 * 월요일에 알려주는 데 있다. 금요일에 알면 늦다.
 *
 * 타임라인의 점선 막대를 끌어 옮기거나 목록으로 던져 버릴 수 있고,
 * 「적용」을 누르기 전까지 DB는 그대로다.
 */

const hm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = ymd(new Date()) === ymd(d);
  return `${today ? '오늘' : `${d.getMonth() + 1}/${d.getDate()}`} (${WEEKDAY_KO[(d.getDay() + 6) % 7]})`;
};

const hours = (min: number) =>
  min >= 60 ? `${Math.round((min / 60) * 10) / 10}시간` : `${min}분`;

export function AutoSchedule() {
  const {
    proposals,
    autoResult,
    autoRange,
    propose,
    dropProposal,
    clearProposals,
    applyProposals,
    revealTask,
  } = useStore();

  /** 날짜별로 묶어야 "수요일에만 몰렸네"가 보인다 */
  const byDay = useMemo(() => {
    const m = new Map<string, typeof proposals>();
    for (const p of [...proposals].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
      const k = ymd(new Date(p.start));
      const arr = m.get(k);
      if (arr) arr.push(p);
      else m.set(k, [p]);
    }
    return [...m.entries()];
  }, [proposals]);

  if (!autoResult) return null;

  const totalMin = proposals.reduce((m, p) => m + p.minutes, 0);
  const unplaced = autoResult.unplaced;

  return (
    <aside className="auto-card" aria-label="자동 배치 제안">
      <header className="auto-head">
        <strong>자동 배치</strong>
        {/* 버튼 두 개로 나누지 않고 여기 둔다 — 눌러보기 전에 고르게 하면 비교를 못 한다 */}
        <div className="chips auto-range">
          <button type="button" className="chip" aria-pressed={autoRange === 'today'} onClick={() => propose('today')}>
            오늘
          </button>
          <button type="button" className="chip" aria-pressed={autoRange === 'week'} onClick={() => propose('week')}>
            7일
          </button>
        </div>
        <span className="count">
          {proposals.length}개 · {hours(totalMin)}
        </span>
        <button type="button" className="icon-btn" onClick={clearProposals} title="제안을 버린다">
          ✕
        </button>
      </header>

      <div className="auto-body">
        {byDay.map(([day, ps]) => (
          <div key={day} className="auto-day">
            <span className="auto-day-label">{dayLabel(ps[0]?.start as string)}</span>
            {ps.map((p) => (
              <div key={p.key} className="auto-row">
                <span className="auto-time">
                  {hm(p.start)}–{hm(p.end)}
                </span>
                <button
                  type="button"
                  className="auto-title"
                  onClick={() => revealTask(p.taskId)}
                  title="이 할 일 보기"
                >
                  {p.title}
                </button>
                <span className="count">{hours(p.minutes)}</span>
                <button type="button" className="icon-btn" onClick={() => dropProposal(p.key)} title="이 제안만 뺀다">
                  ✕
                </button>
              </div>
            ))}
          </div>
        ))}

        {!proposals.length && (
          <p className="hint">
            {autoRange === 'today' ? '오늘 남은 시간에는 넣을 자리가 없다.' : '넣을 제안이 없다.'}
          </p>
        )}

        {unplaced.length > 0 && (
          <div className="auto-unplaced">
            <span className="auto-unplaced-head">
              {autoRange === 'today' ? '오늘 안 들어가는 것' : '이번 주에 안 들어가는 것'} {unplaced.length}개
            </span>
            {unplaced.map((u) => (
              <div key={u.taskId} className="auto-row">
                <button type="button" className="auto-title" onClick={() => revealTask(u.taskId)}>
                  {u.title}
                </button>
                <span className="count">{hours(u.shortfallMin)} 모자람</span>
                <span className="auto-reason">{u.reason}</span>
              </div>
            ))}
            <p className="hint">
              마감을 미루거나, 예상 시간을 줄이거나, 다른 일을 빼야 한다. 늘릴 수 있는 건 시간이 아니다.
            </p>
          </div>
        )}
      </div>

      <footer className="auto-foot">
        <span className="hint">타임라인의 점선 막대를 끌어 옮길 수 있다</span>
        <button type="button" className="ghost-btn" onClick={clearProposals}>
          취소
        </button>
        <button
          type="button"
          className="primary-btn primary-btn-sm"
          disabled={!proposals.length}
          onClick={() => void applyProposals()}
        >
          적용 ({proposals.length})
        </button>
      </footer>
    </aside>
  );
}

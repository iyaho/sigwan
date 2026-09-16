import { checkKey, rangeProgress, routineOccurrences, shiftOrigin, startOfDay, viewRange, ymd, ZOOMS } from '@sigwan/core';
import { useMemo } from 'react';
import { useStore } from '../store';
import { DayColumns } from './DayColumns';
import { MonthGrid } from './MonthGrid';
import { QuarterGrid } from './QuarterGrid';

/**
 * 타임라인 셸 — 줌·이동·기간 라벨·진행도 헤더를 두고, 줌에 따라 본체를 바꾼다.
 *
 *   일     세로 열 1개            (드래그 편집)
 *   주     세로 열 7개 월~일      (드래그 편집, 열 사이 이동 = 날짜 변경)
 *   월     달력 격자              (마감 칩·블록 수, 드롭 = 09:00 블록)
 *   분기   미니 달력 3장          (점만)
 *
 * 명세 3.1·12장은 "가로 간트"였는데, 프로토타입에서 주 뷰 막대가 4.8px로 나와
 * 읽기 전용이 됐다. 세로 열로 세우면 일 뷰 스케일(72px/h)을 그대로 쓸 수 있어서
 * 주 뷰도 편집이 된다. 월·분기는 '언제 무엇이 걸려 있나'만 답하면 되므로 달력이 맞다.
 */
export function Timeline() {
  const { zoom, origin, tasks, routines, routineChecks, setOrigin, setZoom } = useStore();
  const range = useMemo(() => viewRange(zoom, origin), [zoom, origin]);

  const prog = useMemo(() => rangeProgress(tasks, range.start, range.end), [tasks, range]);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : null;

  /**
   * 고정 일정은 Task가 아니다 — 점수·등급·위 진행률에 넣지 않는다.
   * 수업 출석이 과제 우선순위를 밀어내면 안 된다. 그래서 따로 센다.
   * 지나간 것만 분모에 넣는다. 아직 오지 않은 수업을 "안 했다"고 셀 이유가 없다.
   */
  const fixed = useMemo(() => {
    const today = ymd(new Date());
    const occ = routineOccurrences(routines, range.start, range.end).filter((o) => o.day <= today);
    const done = occ.filter((o) => routineChecks[checkKey(o.routine.id, o.day)]).length;
    return { done, total: occ.length };
  }, [routines, routineChecks, range]);

  return (
    <>
      <div className="pane-head">
        <div className="zoombar">
          {(['day', 'week', 'month', 'quarter'] as const).map((z, i) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>
              {ZOOMS[z].label} {i + 1}
            </button>
          ))}
        </div>
        <span className="nav">
          <button type="button" className="ghost-btn" onClick={() => setOrigin(shiftOrigin(zoom, origin, -1))} aria-label="이전">
            ◀
          </button>
          <button type="button" className="ghost-btn" onClick={() => setOrigin(startOfDay(new Date()))}>
            오늘 (T)
          </button>
          <button type="button" className="ghost-btn" onClick={() => setOrigin(shiftOrigin(zoom, origin, 1))} aria-label="다음">
            ▶
          </button>
        </span>
        <span className="range-label">{range.label}</span>
        <span
          className="view-progress range-progress"
          title={`이 기간에 마감이 있는 할 일 — 완료 ${prog.done} / 전체 ${prog.total}`}
        >
          <span className="progress progress-inline">
            <span className="progress-bar" style={{ width: `${pct ?? 0}%` }} />
          </span>
          <span className="count pct">{pct === null ? '—' : `${pct}%`}</span>
        </span>
        {fixed.total > 0 && (
          <span className="fixed-count" title="고정 일정 — 지난 것 중 체크한 개수. 점수에는 들어가지 않는다">
            고정 {fixed.done}/{fixed.total}
          </span>
        )}
        {zoom === 'day' || zoom === 'week' ? (
          <span className="head-hint">Alt = 스냅 해제 · 막대 아래끝 = 길이 조절{zoom === 'week' ? ' · 옆 열로 끌면 날짜 이동' : ''}</span>
        ) : (
          <span className="urg-legend" title="마감 칩 색 = 임박도. 점수의 U와 같은 값">
            멀다 <i /> 급하다
          </span>
        )}
      </div>

      {zoom === 'day' && <DayColumns start={range.start} days={1} />}
      {zoom === 'week' && <DayColumns start={range.start} days={7} />}
      {zoom === 'month' && (
        <div className="tl-wrap">
          <MonthGrid monthStart={range.start} />
        </div>
      )}
      {zoom === 'quarter' && (
        <div className="tl-wrap">
          <QuarterGrid start={range.start} />
        </div>
      )}
    </>
  );
}

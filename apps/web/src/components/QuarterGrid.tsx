import { addMonths } from '../lib/calendar';
import { MonthGrid } from './MonthGrid';

/** 분기 뷰 — 미니 달력 세 장. 점 = 그 날 마감 (색은 가장 급한 것) */
export function QuarterGrid({ start }: { start: Date }) {
  return (
    <div className="qgrid">
      {[0, 1, 2].map((i) => (
        <MonthGrid key={i} monthStart={addMonths(start, i)} compact />
      ))}
    </div>
  );
}

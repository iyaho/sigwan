import { hhmm, parseHhmm } from '@sigwan/core';
import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { RoutineGrid } from './RoutineGrid';

/**
 * 3.8 설정 — 자동 배치가 피해야 할 것 두 가지를 받는다.
 *
 *  수면      평일·주말 두 벌만 받는다. 요일별 7줄은 정확하지만 아무도 안 채운다.
 *  고정 일정 수업·알바처럼 매주 같은 자리에 있는 것. 규칙으로 저장하고 화면에서 펼친다.
 *
 * 둘 다 "안 되는 시간"이다. 자동 배치는 남은 자리에만 들어간다.
 */

const GAP_CHIPS = [0, 5, 10, 15];

/**
 * 컴포넌트 밖에 둔다. 안에 정의하면 렌더마다 새 컴포넌트 타입이 되어
 * React가 DOM을 새로 만들고, 시각을 고치는 중에 포커스가 날아간다.
 */
function TimeCell({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <label className="sub-row">
      <span className="sub-label" style={{ width: 40 }}>
        {label}
      </span>
      <input
        type="time"
        className="txt txt-sm"
        value={hhmm(value)}
        onChange={(e) => {
          const v = parseHhmm(e.target.value);
          if (v !== null) onChange(v);
        }}
      />
    </label>
  );
}

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, saveSleep, setGapMin } = useStore();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const sleep = settings.sleep;

  /** 취침 → 기상 길이. 자정을 넘으면 1440을 더한다 */
  const hours = (from: number, to: number) => {
    const min = to >= from ? to - from : to + 1440 - from;
    return `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}`;
  };

  return (
    <dialog ref={ref} className="add-dialog set-dialog" onClose={onClose} onCancel={onClose}>
      <header className="add-head">
        <strong>설정</strong>
        <button type="button" className="ghost-btn" onClick={onClose}>
          닫기 (Esc)
        </button>
      </header>

      <div className="add-body">
        {/* ── 수면 ─────────────────────────────────────────── */}
        <div className="fld">
          <span className="fld-label">수면</span>
          <p className="hint">
            자동 배치가 이 시간을 피한다. 평일·주말 판정은 <b>일어나는 날</b> 기준이다 — 금요일 밤은 주말 규칙이다.
          </p>
          <div className="set-grid">
            <div className="set-card">
              <span className="set-card-title">평일 (월~금 기상)</span>
              <TimeCell label="취침" value={sleep.weekdayStart} onChange={(v) => void saveSleep({ ...sleep, weekdayStart: v })} />
              <TimeCell label="기상" value={sleep.weekdayEnd} onChange={(v) => void saveSleep({ ...sleep, weekdayEnd: v })} />
              <span className="count">{hours(sleep.weekdayStart, sleep.weekdayEnd)}</span>
            </div>
            <div className="set-card">
              <span className="set-card-title">주말 (토·일 기상)</span>
              <TimeCell label="취침" value={sleep.weekendStart} onChange={(v) => void saveSleep({ ...sleep, weekendStart: v })} />
              <TimeCell label="기상" value={sleep.weekendEnd} onChange={(v) => void saveSleep({ ...sleep, weekendEnd: v })} />
              <span className="count">{hours(sleep.weekendStart, sleep.weekendEnd)}</span>
            </div>
          </div>
        </div>

        {/* ── 간격 ─────────────────────────────────────────── */}
        <div className="fld">
          <span className="fld-label">자동 배치 간격</span>
          <div className="chips">
            {GAP_CHIPS.map((v) => (
              <button
                key={v}
                type="button"
                className="chip"
                aria-pressed={settings.gap_min === v}
                onClick={() => void setGapMin(v)}
              >
                {v === 0 ? '없음' : `${v}분`}
              </button>
            ))}
          </div>
          <span className="hint">수업이 끝나자마자 다음 일을 시작할 수는 없다. 맞닿는 자리마다 이만큼 띄운다.</span>
        </div>

        {/* ── 고정 일정 ────────────────────────────────────── */}
        <div className="fld">
          <span className="fld-label">고정 일정</span>
          <p className="hint">
            수업·알바처럼 매주 같은 자리에 있는 것. 한 주치를 그려두면 학기 내내 적용된다.
            회색 띠는 수면이다.
          </p>
          <RoutineGrid />
        </div>

      </div>
    </dialog>
  );
}

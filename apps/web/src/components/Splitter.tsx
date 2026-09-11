import type * as React from 'react';
import { useCallback, useRef, useState } from 'react';

/**
 * 패널 경계 드래그 손잡이.
 *
 * 보이는 선은 1px이지만 잡는 영역은 9px이다 — 1px짜리를 마우스로 맞추는 건 고문이다.
 * 드래그 중에는 포인터를 캡처해서 커서가 막대 밖으로 나가도 따라온다.
 *
 * 키보드로도 움직인다(방향키 / Shift+방향키 = 10배). 더블클릭하면 기본값으로 돌아간다.
 */

interface Props {
  axis: 'x' | 'y';
  /** 포인터의 현재 clientX(세로선) 또는 clientY(가로선) */
  onMove: (client: number) => void;
  /** 손을 뗄 때 — 저장은 여기서 */
  onCommit: () => void;
  /** 방향키 한 칸. +1이 오른쪽/아래 */
  onStep: (dir: 1 | -1, big: boolean) => void;
  onReset: () => void;
  label: string;
}

export function Splitter({ axis, onMove, onCommit, onStep, onReset, label }: Props) {
  const [dragging, setDragging] = useState(false);
  const raf = useRef(0);

  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const v = axis === 'x' ? e.clientX : e.clientY;
      // 포인터 이벤트는 프레임당 여러 번 온다. 한 프레임에 한 번만 반영한다.
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => onMove(v));
    },
    [dragging, axis, onMove],
  );

  return (
    <div
      className={`splitter splitter-${axis}`}
      data-dragging={dragging}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={handleMove}
      onPointerUp={(e) => {
        if (!dragging) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        cancelAnimationFrame(raf.current);
        setDragging(false);
        onCommit();
      }}
      onPointerCancel={() => {
        setDragging(false);
        onCommit();
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== back && e.key !== fwd) return;
        e.preventDefault();
        onStep(e.key === fwd ? 1 : -1, e.shiftKey);
      }}
    />
  );
}

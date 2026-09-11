import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { TaskDetail } from './TaskDetail';

/**
 * 12장 우측 320px — Task 상세 + 점수 분해.
 * 중요도를 4→5로 바꾸면 점수가 즉시 바뀌는 게 핵심이다 (3.3 폼 설계 원칙 4).
 *
 * 좁은 화면에서는 열이 아니라 오른쪽에서 덮는 오버레이가 된다(app.css).
 * 오버레이일 때만 바깥 클릭으로 닫는다 — 3열로 붙어 있을 때는 바깥이 곧 작업 공간이라
 * 간트를 만질 때마다 패널이 닫히면 못 쓴다.
 */
export function DetailPanel() {
  const { tasks, selectedTaskId, select } = useStore();
  const task = tasks.find((t) => t.id === selectedTaskId);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!task) return;
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el || getComputedStyle(el).position !== 'fixed') return; // 오버레이일 때만
      const t = e.target as Node;
      if (el.contains(t)) return;
      // 리스트에서 다른 할 일을 고르는 클릭은 "바깥 클릭"이 아니다 — 그 선택이 이겨야 한다
      if ((t as Element).closest?.('.task')) return;
      select(null);
    };
    // capture로 받아 다른 핸들러가 stopPropagation 해도 놓치지 않는다
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [task, select]);

  if (!task) {
    return (
      <aside className="col detail" data-open={false} ref={ref}>
        <div className="pane-head">상세</div>
        <p className="empty">할 일을 고르면 점수 분해가 여기 나온다.</p>
      </aside>
    );
  }

  return (
    <aside className="col detail" data-open={true} ref={ref}>
      <div className="pane-head">
        상세
        <button type="button" className="detail-close ghost-btn" onClick={() => select(null)}>
          닫기
        </button>
      </div>
      <div className="pane-body">
        <TaskDetail task={task} />
      </div>
    </aside>
  );
}

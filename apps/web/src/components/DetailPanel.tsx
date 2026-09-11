import type * as React from 'react';
import { GRADE_COLOR, GRADE_LABEL, priorityScore } from '@sigwan/core';
import { useStore } from '../store';

/** 12장 우측 320px — Task 상세 + 점수 분해.
 *  중요도를 4→5로 바꾸면 점수가 즉시 바뀌는 게 핵심이다 (3.3 폼 설계 원칙 4). */
export function DetailPanel() {
  const { tasks, selectedTaskId, saveTask, blocks, select } = useStore();
  const task = tasks.find((t) => t.id === selectedTaskId);

  if (!task) {
    return (
      <aside className="col detail" data-open={false}>
        <div className="pane-head">상세</div>
        <p className="empty">할 일을 고르면 점수 분해가 여기 나온다.</p>
      </aside>
    );
  }

  const s = priorityScore(task);
  const myBlocks = blocks.filter((b) => b.task_id === task.id && !b.deleted_at);

  return (
    <aside className="col detail" data-open={true}>
      <div className="pane-head">
        상세
        <button type="button" className="detail-close ghost-btn" onClick={() => select(null)}>
          닫기
        </button>
      </div>
      <div className="pane-body detail-body">
        <h2>{task.title}</h2>

        <dl className="kv">
          <dt>종류</dt>
          <dd>{{ day: '하루 투두', deadline: '기한 투두', someday: '인박스' }[task.kind]}</dd>
          <dt>마감</dt>
          <dd>{task.due_at ? new Date(task.due_at).toLocaleString('ko-KR') : task.day_of ?? '—'}</dd>
          <dt>예상</dt>
          <dd>
            <input
              type="number"
              min={0}
              step={15}
              value={task.estimate_min}
              onChange={(e) => saveTask({ ...task, estimate_min: Number(e.target.value) })}
              style={inputStyle}
            />{' '}
            분
            {task.estimate_is_ai && <span className="ai-badge" style={{ marginLeft: 6 }}>AI 추정</span>}
          </dd>
          <dt>진행</dt>
          <dd>{task.spent_min}분</dd>
          <dt>중요도</dt>
          <dd>
            <input
              type="range"
              min={1}
              max={5}
              value={task.importance}
              onChange={(e) => saveTask({ ...task, importance: Number(e.target.value) })}
              style={{ width: 120, verticalAlign: 'middle' }}
            />{' '}
            {task.importance}
          </dd>
          <dt>블록</dt>
          <dd>{myBlocks.length ? `${myBlocks.length}개` : '미스케줄'}</dd>
          <dt>출처</dt>
          <dd>{task.source}</dd>
        </dl>

        <div className="score-box">
          <h3>점수 분해</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="score-num">{Number.isFinite(s.score) ? s.score.toFixed(1) : '—'}</span>
            <span className="grade-pill" style={{ background: GRADE_COLOR[s.grade] }}>
              {GRADE_LABEL[s.grade]}
            </span>
          </div>
          <ul className="score-reasons">
            {s.reasons.map((r) => (
              <li key={r}>· {r}</li>
            ))}
            {Number.isFinite(s.score) && (
              <li style={{ marginTop: 6, color: 'var(--text-faint)' }}>
                0.6×{s.urgency.toFixed(1)} + 0.4×{s.importance} {s.boost >= 0 ? '+' : '−'}{' '}
                {Math.abs(s.boost)} = {s.score.toFixed(1)}
              </li>
            )}
          </ul>
        </div>

        {task.notes && (
          <p style={{ marginTop: 20, fontSize: 12.5, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>
            {/* 지금은 평문. 마크다운 렌더를 붙이는 순간 DOMPurify가 필요하다 (10장 7번) */}
            {task.notes}
          </p>
        )}
      </div>
    </aside>
  );
}

const inputStyle: React.CSSProperties = {
  width: 68,
  padding: '2px 6px',
  border: '1px solid var(--border)',
  borderRadius: 5,
  background: 'var(--bg)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 12.5,
};

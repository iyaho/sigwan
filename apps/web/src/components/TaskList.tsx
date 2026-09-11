import type { Tag, Task } from '@sigwan/core';
import { GRADE_COLOR, priorityScore, sortByPriority } from '@sigwan/core';
import { useMemo } from 'react';
import { useLayout } from '../lib/layout';
import { filterByView } from '../lib/views';
import { useStore } from '../store';
import { TaskDetail } from './TaskDetail';

export function TaskList() {
  const { tasks, view, selectedTagIds, taskTags, tags, selectedTaskId, select, toggleDone } =
    useStore();
  const detailMode = useLayout((s) => s.detailMode);
  const inline = detailMode === 'inline';

  const rows = useMemo(() => {
    const now = new Date();
    let list = filterByView(tasks, view, now);
    if (selectedTagIds.length) {
      list = list.filter((t) => (taskTags[t.id] ?? []).some((id) => selectedTagIds.includes(id)));
    }
    // 고른 줄은 뷰 조건에서 벗어나도 목록에 남긴다.
    // 상세에서 마감을 고치면 그 줄이 필터 밖으로 나가는데, 그때 편집하던 칸이
    // 통째로 사라지면 무슨 일이 일어난 건지 알 수가 없다.
    if (selectedTaskId && !list.some((t) => t.id === selectedTaskId)) {
      const sel = tasks.find((t) => t.id === selectedTaskId && !t.deleted_at);
      if (sel) list = [...list, sel];
    }
    // 인박스·완료함은 점수 정렬 대상이 아니므로 수동 순서를 유지한다 (2장)
    return view === 'inbox' || view === 'done' ? list : sortByPriority(list, now);
  }, [tasks, view, selectedTagIds, taskTags, selectedTaskId]);

  const inView = useMemo(
    () => new Set(filterByView(tasks, view).map((t) => t.id)),
    [tasks, view],
  );

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  if (!rows.length) return <p className="empty">여기엔 아무것도 없다.</p>;

  return (
    <div>
      {rows.map((t) => {
        const open = selectedTaskId === t.id;
        return (
          <div key={t.id} className="task-group" data-open={inline && open}>
            <Row
              task={t}
              selected={open}
              offView={!inView.has(t.id)}
              inline={inline}
              open={open}
              tagNames={(taskTags[t.id] ?? []).map((id) => tagById.get(id)).filter(Boolean)}
              // 인라인에서는 같은 줄을 다시 누르면 접힌다. 패널 모드에선 선택만 옮긴다.
              onSelect={() => select(inline && open ? null : t.id)}
              onToggle={() => toggleDone(t.id)}
            />
            {inline && open && (
              // 리스트 칸이 짧을 때 펼치면 내용이 화면 밖에 생긴다. 펼치는 순간 끌어올린다.
              <div
                className="task-inline"
                ref={(el) => {
                  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }}
              >
                <TaskDetail task={t} compact />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Row({
  task,
  selected,
  offView,
  inline,
  open,
  tagNames,
  onSelect,
  onToggle,
}: {
  task: Task;
  selected: boolean;
  offView: boolean;
  inline: boolean;
  open: boolean;
  tagNames: (Tag | undefined)[];
  onSelect: () => void;
  onToggle: () => void;
}) {
  const s = priorityScore(task);
  return (
    <div
      className="task"
      data-selected={selected}
      data-done={task.status === 'done'}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/sigwan-task', task.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onSelect}
    >
      <div className="stripe" style={{ background: GRADE_COLOR[s.grade] }} />
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: 2 }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="title">{task.title}</div>
        <div className="meta">
          {task.due_at && <span>{fmtDue(task.due_at)}</span>}
          {task.day_of && !task.due_at && <span>{task.day_of}</span>}
          <span>{fmtEst(task.estimate_min)}</span>
          <span>중요도 {task.importance}</span>
          {task.estimate_is_ai && <span className="ai-badge">AI 추정</span>}
          {task.pinned && <span>📌</span>}
          {offView && <span className="offview-badge">이 뷰 밖</span>}
          {tagNames.map(
            (t) =>
              t && (
                <span key={t.id} className="tagchip">
                  <i className="tagdot" style={{ background: t.color }} />
                  {t.name}
                </span>
              ),
          )}
        </div>
      </div>
      {inline && (
        <span className="chev" data-open={open} aria-hidden="true">
          ›
        </span>
      )}
    </div>
  );
}

function fmtEst(min: number) {
  return min >= 60 ? `${(min / 60).toFixed(min % 60 ? 1 : 0)}h` : `${min}m`;
}

function fmtDue(iso: string) {
  const d = new Date(iso);
  const diff = (d.getTime() - Date.now()) / 864e5;
  const s = d.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (diff < 0) return `${s} 지남`;
  return s;
}

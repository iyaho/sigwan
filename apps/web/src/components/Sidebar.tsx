import { useMemo } from 'react';
import { type ViewKey, useStore } from '../store';

const VIEWS: [ViewKey, string][] = [
  ['today', '오늘'],
  ['next7', '다음 7일'],
  ['all', '전체 (급한 순)'],
  ['inbox', '인박스'],
  ['done', '완료함'],
];

export function Sidebar() {
  const { view, setView, tags, selectedTagIds, toggleTag, tasks } = useStore();

  const counts = useMemo(() => {
    const live = tasks.filter((t) => !t.deleted_at);
    return {
      inbox: live.filter((t) => t.kind === 'someday' && t.status !== 'done').length,
      done: live.filter((t) => t.status === 'done').length,
      all: live.filter((t) => t.status !== 'done').length,
    };
  }, [tasks]);

  return (
    <aside className="col sidebar">
      <div className="pane-head">
        <span className="brand">시관</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>M1 · 로컬 저장</span>
      </div>
      <div className="pane-body">
        <ul className="navlist">
          {VIEWS.map(([k, label]) => (
            <li key={k}>
              <button type="button" aria-current={view === k} onClick={() => setView(k)}>
                {label}
                {k in counts && <span className="count">{counts[k as keyof typeof counts]}</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="section-label">태그</div>
        <ul className="navlist">
          {tags.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                aria-current={selectedTagIds.includes(t.id)}
                onClick={() => toggleTag(t.id)}
              >
                <span className="tagchip">
                  <i className="tagdot" style={{ background: t.color }} />
                  {t.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

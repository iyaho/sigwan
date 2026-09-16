import type * as React from 'react';
import { useMemo, useState } from 'react';
import { resetAll } from '../lib/db';
import { useLayout } from '../lib/layout';
import { useStore } from '../store';
import { type ViewKey, viewProgress } from '@sigwan/core';

const VIEWS: [ViewKey, string][] = [
  ['today', '오늘'],
  ['next7', '다음 7일'],
  ['all', '전체 (급한 순)'],
  ['inbox', '인박스'],
  ['done', '완료함'],
];

/** 3.4 — 태그는 계층이 없다. 색은 막대·스트라이프에 쓰이므로 구분되는 것만 고른다. */
export const TAG_COLORS = [
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
  '#e5484d',
  '#f76b15',
  '#ffc53d',
  '#30a46c',
  '#0d9488',
  '#8b8d98',
];

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { view, setView, tags, selectedTagIds, toggleTag, tasks, taskTags } = useStore();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const collapsed = useLayout((l) => l.sidebarCollapsed);
  const toggleSidebar = useLayout((l) => l.toggleSidebar);

  const counts = useMemo(() => {
    const live = tasks.filter((t) => !t.deleted_at);
    return {
      inbox: live.filter((t) => t.kind === 'someday' && t.status !== 'done').length,
      done: live.filter((t) => t.status === 'done').length,
    };
  }, [tasks]);

  /** 오늘·다음 7일·전체는 "완료/전체 + 막대". 인박스·완료함은 개수만 */
  const progress = useMemo(() => {
    const now = new Date();
    const m: Partial<Record<ViewKey, { done: number; total: number }>> = {};
    for (const [k] of VIEWS) {
      const p = viewProgress(tasks, k, now);
      if (p) m[k] = p;
    }
    return m;
  }, [tasks]);

  /** 태그별 사용 건수 — 지우기 전에 얼마나 물려 있는지 보여준다 */
  const usage = useMemo(() => {
    const m: Record<string, number> = {};
    for (const ids of Object.values(taskTags)) for (const id of ids) m[id] = (m[id] ?? 0) + 1;
    return m;
  }, [taskTags]);

  if (collapsed) {
    // 44px 레일. 뷰 이름 첫 글자만 — 넓힐 때까지 필터가 뭔지 잊지 않게
    return (
      <aside className="col sidebar rail">
        <button
          type="button"
          className="icon-btn rail-btn"
          title="사이드바 펼치기  ["
          onClick={toggleSidebar}
        >
          ›
        </button>
        <ul className="rail-views">
          {VIEWS.map(([k, label]) => (
            <li key={k}>
              <button
                type="button"
                className="icon-btn rail-btn"
                aria-current={view === k}
                title={label}
                onClick={() => setView(k)}
              >
                {label.slice(0, 1)}
              </button>
            </li>
          ))}
        </ul>
        {selectedTagIds.length > 0 && (
          <span className="rail-dot" title={`태그 필터 ${selectedTagIds.length}개 켜짐`} />
        )}
      </aside>
    );
  }

  return (
    <aside className="col sidebar">
      <div className="pane-head">
        <span className="brand">시관</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>M1 · 로컬 저장</span>
        <button
          type="button"
          className="icon-btn"
          style={{ marginLeft: 'auto' }}
          title="사이드바 접기  ["
          onClick={toggleSidebar}
        >
          ‹
        </button>
      </div>
      <div className="pane-body">
        <ul className="navlist">
          {VIEWS.map(([k, label]) => (
            <li key={k}>
              <button type="button" aria-current={view === k} onClick={() => setView(k)}>
                {label}
                {progress[k] ? (
                  <span className="view-progress" title={`완료 ${progress[k].done} / 전체 ${progress[k].total}`}>
                    <span className="progress progress-inline">
                      <span
                        className="progress-bar"
                        style={{
                          width: progress[k].total
                            ? `${(progress[k].done / progress[k].total) * 100}%`
                            : '0%',
                        }}
                      />
                    </span>
                    <span className="count pct">
                      {progress[k].total
                        ? `${Math.round((progress[k].done / progress[k].total) * 100)}%`
                        : '—'}
                    </span>
                  </span>
                ) : (
                  k in counts && <span className="count">{counts[k as keyof typeof counts]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="section-label tag-head">
          <span>태그</span>
          <button
            type="button"
            className="icon-btn"
            title="태그 추가"
            onClick={() => {
              setAdding((v) => !v);
              setEditing(false);
            }}
          >
            +
          </button>
          <button
            type="button"
            className="icon-btn"
            title="태그 편집"
            aria-pressed={editing}
            onClick={() => {
              setEditing((v) => !v);
              setAdding(false);
            }}
          >
            ✎
          </button>
        </div>

        {adding && <TagAdd onDone={() => setAdding(false)} />}

        <ul className="navlist">
          {tags.map((t) =>
            editing ? (
              <li key={t.id}>
                <TagEditRow id={t.id} name={t.name} color={t.color} count={usage[t.id] ?? 0} />
              </li>
            ) : (
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
                  <span className="count">{usage[t.id] ?? 0}</span>
                </button>
              </li>
            ),
          )}
        </ul>
        {!tags.length && <p className="hint" style={{ padding: '0 16px' }}>태그가 없다. + 로 만든다.</p>}
      </div>
      <div className="side-foot">
        <button type="button" className="icon-btn" onClick={onOpenSettings} title="수면·고정 일정 (3.8)">
          ⚙ 설정
        </button>
      </div>
      {import.meta.env.DEV && (
        // 개발 빌드에만 있는 버튼. 목 데이터(16.8-4)를 지우고 다시 심는다 — 제품 빌드에서는 컴파일 자체가 빠진다
        <div className="dev-foot">
          <button
            type="button"
            className="icon-btn"
            title="개발용 — 목 데이터를 지우고 새로 심는다"
            onClick={() => resetAll().then(() => location.reload())}
          >
            dev · 목 데이터 리셋
          </button>
        </div>
      )}
    </aside>
  );
}

function TagAdd({ onDone }: { onDone: () => void }) {
  const { addTag, tags } = useStore();
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[tags.length % TAG_COLORS.length] as string);
  const [dup, setDup] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = await addTag(name, color);
    if (id === null) {
      setDup(true);
      return;
    }
    onDone();
  }

  return (
    <form className="tag-form" onSubmit={submit}>
      <ColorPicker value={color} onChange={setColor} />
      {/* biome-ignore lint/a11y/noAutofocus: 이 칸 때문에 열린 폼이다 */}
      <input
        autoFocus
        className="txt txt-sm"
        style={{ flex: 1, minWidth: 0 }}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setDup(false);
        }}
        placeholder="태그 이름"
        maxLength={50}
      />
      <button type="submit" className="primary-btn primary-btn-sm" disabled={!name.trim()}>
        추가
      </button>
      {dup && <p className="hint tag-form-err">같은 이름이 이미 있다</p>}
    </form>
  );
}

function TagEditRow({
  id,
  name,
  color,
  count,
}: {
  id: string;
  name: string;
  color: string;
  count: number;
}) {
  const { updateTag, removeTag } = useStore();
  const [value, setValue] = useState(name);
  // 두 번 눌러야 지워진다. window.confirm은 쓰지 않는다 — 브라우저 모달은
  // 페이지를 통째로 막아서 다른 자동화·테스트까지 세운다.
  const [armed, setArmed] = useState(false);

  return (
    <div className="tag-row">
      <ColorPicker value={color} onChange={(c) => updateTag(id, { color: c })} />
      <input
        className="txt txt-sm tag-row-name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() !== name && updateTag(id, { name: value })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        maxLength={50}
      />
      <button
        type="button"
        className={armed ? 'icon-btn danger' : 'icon-btn'}
        title={count ? `${count}개 할 일에 붙어 있다` : '쓰이지 않는 태그'}
        onClick={() => (armed ? removeTag(id) : setArmed(true))}
        onBlur={() => setArmed(false)}
      >
        {armed ? `지울까? (${count})` : '×'}
      </button>
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="color-pick">
      <button
        type="button"
        className="swatch"
        style={{ background: value }}
        title="색"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <span className="palette">
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: c }}
              aria-pressed={c === value}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
        </span>
      )}
    </span>
  );
}

import type * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { DetailPanel } from './components/DetailPanel';
import { Sidebar } from './components/Sidebar';
import { Splitter } from './components/Splitter';
import { TaskList } from './components/TaskList';
import { Timeline } from './components/Timeline';
import { resetAll } from './lib/db';
import { useLayout } from './lib/layout';
import { useStore } from './store';

export default function App() {
  const { ready, load, setZoom, setOrigin } = useStore();
  const { sidebarPx, listPct, set, commit, reset } = useLayout();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // 12장 단축키: 1–4 줌 / T 오늘
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === 'INPUT' || el?.isContentEditable) return;
      const z = { '1': 'day', '2': 'week', '3': 'month', '4': 'quarter' } as const;
      if (e.key in z) setZoom(z[e.key as keyof typeof z]);
      if (e.key.toLowerCase() === 't') {
        const n = new Date();
        setOrigin(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [setZoom, setOrigin]);

  // 세로 선: 포인터의 clientX가 곧 사이드바 폭이다 (사이드바가 화면 왼쪽 끝에 붙어 있으므로)
  const moveSidebar = useCallback((clientX: number) => set({ sidebarPx: clientX }), [set]);

  // 가로 선: 가운데 열 안에서의 상대 위치를 %로 바꾼다
  const moveList = useCallback(
    (clientY: number) => {
      const r = mainRef.current?.getBoundingClientRect();
      if (!r || r.height === 0) return;
      set({ listPct: ((r.bottom - clientY) / r.height) * 100 });
    },
    [set],
  );

  if (!ready) return <p className="empty">불러오는 중…</p>;

  return (
    <div className="shell" style={{ '--sidebar-w': `${sidebarPx}px` } as React.CSSProperties}>
      <Sidebar />

      <Splitter
        axis="x"
        label="사이드바 너비"
        onMove={moveSidebar}
        onCommit={commit}
        onStep={(dir, big) => {
          set({ sidebarPx: sidebarPx + dir * (big ? 40 : 8) });
          commit();
        }}
        onReset={() => reset('sidebarPx')}
      />

      <main className="col" ref={mainRef}>
        <section className="col pane-grow">
          <Timeline />
        </section>

        <Splitter
          axis="y"
          label="간트와 할 일 목록 비율"
          onMove={moveList}
          onCommit={commit}
          onStep={(dir, big) => {
            set({ listPct: listPct - dir * (big ? 10 : 2) });
            commit();
          }}
          onReset={() => reset('listPct')}
        />

        <section className="col" style={{ flex: `0 0 ${listPct}%`, height: 'auto' }}>
          <div className="pane-head">
            할 일 — 리스트에서 위 타임라인으로 끌어다 놓으면 블록이 생긴다
            <button
              type="button"
              onClick={() => resetAll().then(() => location.reload())}
              className="ghost-btn"
              style={{ marginLeft: 'auto' }}
            >
              목 데이터 리셋
            </button>
          </div>
          <div className="pane-body">
            <TaskList />
          </div>
        </section>
      </main>

      <DetailPanel />
    </div>
  );
}

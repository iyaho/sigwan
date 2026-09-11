import { create } from 'zustand';

/**
 * 패널 비율. 데이터가 아니라 "이 브라우저에서 내가 보는 방식"이라 Dexie가 아니라
 * localStorage에 둔다. M2에서 설정 동기화가 생기면 계정으로 옮길 자리다.
 *
 * 비율을 쓰는 곳과 저장하는 곳을 나눈다 — 드래그 중에 매 프레임 localStorage를
 * 쓰면 메인 스레드가 동기 I/O로 막힌다. 저장은 손을 뗄 때 한 번.
 */

const KEY = 'sigwan.layout.v1';

/**
 * 상세를 어디에 띄우는가 — 어느 쪽이 나은지 정하려고 둘 다 남겨둔 스위치다.
 *  panel : 오른쪽 열(넓으면 3열 고정, 좁으면 오버레이)
 *  inline: 리스트에서 그 줄 바로 아래로 펼침 — 오른쪽 열이 사라진다
 * M1이 끝나고 한쪽을 고르면 나머지 코드는 지운다.
 */
export type DetailMode = 'panel' | 'inline';

export interface Layout {
  /** 좌측 사이드바 폭(px) */
  sidebarPx: number;
  /** 아래 할 일 리스트가 가운데 열에서 차지하는 비율(%) — 나머지가 간트 */
  listPct: number;
  detailMode: DetailMode;
}

export const LAYOUT_DEFAULT: Layout = { sidebarPx: 240, listPct: 30, detailMode: 'panel' };

const LIMIT = {
  sidebarPx: [168, 420],
  listPct: [14, 72],
} as const;

export const clampLayout = (l: Layout): Layout => ({
  sidebarPx: clamp(l.sidebarPx, ...LIMIT.sidebarPx),
  listPct: clamp(l.listPct, ...LIMIT.listPct),
  detailMode: l.detailMode === 'inline' ? 'inline' : 'panel',
});

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function read(): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return LAYOUT_DEFAULT;
    const p = JSON.parse(raw) as Partial<Layout>;
    return clampLayout({ ...LAYOUT_DEFAULT, ...p });
  } catch {
    // 사생활 보호 모드·저장소 차단에서 던진다. 기본값으로 계속 가면 된다.
    return LAYOUT_DEFAULT;
  }
}

interface LayoutState extends Layout {
  /** 드래그 중 — 값만 바꾸고 저장하지 않는다 */
  set: (patch: Partial<Layout>) => void;
  /** 손을 뗄 때 — 여기서만 저장한다 */
  commit: () => void;
  toggleDetailMode: () => void;
  reset: (key: 'sidebarPx' | 'listPct') => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  ...read(),
  set: (patch) => set(clampLayout({ ...get(), ...patch })),
  commit: () => {
    try {
      const { sidebarPx, listPct, detailMode } = get();
      localStorage.setItem(KEY, JSON.stringify({ sidebarPx, listPct, detailMode }));
    } catch {
      /* 저장 못 해도 이번 세션은 그대로 쓴다 */
    }
  },
  toggleDetailMode: () => {
    set({ detailMode: get().detailMode === 'panel' ? 'inline' : 'panel' });
    get().commit();
  },
  reset: (key) => {
    set({ [key]: LAYOUT_DEFAULT[key] } as Partial<Layout>);
    get().commit();
  },
}));

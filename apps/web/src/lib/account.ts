import type { SyncReport } from '@sigwan/core';
import {
  authEmail,
  authErrorMessage,
  createSupabaseServer,
  createSyncRunner,
  normalizeUsername,
  passwordError,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  usernameError,
} from '@sigwan/core';
import { createClient, type Session } from '@supabase/supabase-js';
import { useStore } from '../store';
import { db, enqueueAll, wipeLocal } from './db';
import { dexieSyncLocal } from './sync';

/**
 * 9.1 계정 + 7장 동기화를 웹에 붙인다. 화면은 signUp / signIn / signOut만 부른다.
 *
 * 세션은 supabase-js가 localStorage에 둔다. 할 일 데이터(IndexedDB)와는 따로다 —
 * 로그아웃하면 둘 다 지운다(9.2.1).
 */

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_KEY,
);

let session: Session | null = null;
const server = createSupabaseServer((fn, args) => supabase.rpc(fn, args));

export const sync = createSyncRunner({
  local: dexieSyncLocal,
  server: () => (session ? server : null),
  onPulled: async (r: SyncReport) => {
    if (r.pulled > 0) await useStore.getState().load();
  },
  onStatus: (syncStatus) => useStore.setState({ syncStatus }),
});

/** 이 기기가 마지막으로 합친 계정. 다르면(처음 로그인) 기기 데이터를 전부 올린다 */
const ACCOUNT_KEY = 'account_uid';

async function afterSignIn(s: Session) {
  session = s;
  useStore.setState({ account: { username: String(s.user.user_metadata?.username ?? '') } });
  const prev = await db.meta.get(ACCOUNT_KEY);
  if (prev?.value !== s.user.id) {
    // 9.2.1 — 로그인 전에 쓴 것을 계정에 합친다. 예시는 enqueueAll이 먼저 치운다
    await enqueueAll();
    await db.meta.put({ key: ACCOUNT_KEY, value: s.user.id });
    await useStore.getState().load();
  }
  sync.start();
  await sync.syncNow();
}

let initialized = false;

/** 앱을 열 때 한 번. 저장된 세션이 있으면 이어서 동기화한다 */
export async function initAccount() {
  // 개발 모드의 StrictMode가 effect를 두 번 돌린다 — 리스너가 두 벌 붙지 않게
  if (initialized) return;
  initialized = true;
  const { data } = await supabase.auth.getSession();
  if (data.session) await afterSignIn(data.session);
  supabase.auth.onAuthStateChange((event, s) => {
    // 토큰이 갱신될 때마다 온다. 세션만 바꿔 끼운다 — 로그인·로그아웃 처리는 아래 함수들이 한다
    session = s;
    // 갱신이 끝내 실패하면(계정이 지워졌다 등) 여기로 온다. 데이터는 그대로 두고 게스트로 보인다
    if (event === 'SIGNED_OUT') useStore.setState({ account: null });
  });

  // 7장 — 쓰기가 생기면 2초 모았다가, 창으로 돌아오거나 다시 연결되면 바로
  db.outbox.hook('creating', () => {
    if (session) sync.schedule();
  });
  window.addEventListener('focus', () => void sync.syncNow());
  window.addEventListener('online', () => void sync.syncNow());
}

function check(username: string, password: string) {
  const e = usernameError(username) ?? passwordError(password);
  if (e) throw new Error(e);
}

export async function signUp(username: string, password: string) {
  check(username, password);
  const u = normalizeUsername(username);
  const { data, error } = await supabase.auth.signUp({
    email: authEmail(u),
    password,
    options: { data: { username: u } },
  });
  if (error) throw new Error(authErrorMessage(error));
  if (!data.session) throw new Error('가입은 됐는데 로그인이 안 됐다 — 서버의 Confirm email이 켜져 있다');
  await afterSignIn(data.session);
}

export async function signIn(username: string, password: string) {
  if (!username.trim() || !password) throw new Error('아이디와 비밀번호를 넣는다');
  const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail(username), password });
  if (error) throw new Error(authErrorMessage(error));
  await afterSignIn(data.session);
}

/** 아직 서버에 못 올린 변경 수 — 로그아웃 전에 보여 준다 */
export async function pendingCount() {
  return db.outbox.count();
}

/**
 * 로그아웃 — 남은 변경을 한 번 올려 보고, 세션과 이 기기의 데이터를 지운다(9.2.1).
 * 다시 열면 처음처럼 예시가 보인다.
 */
export async function signOut() {
  await sync.syncNow();
  sync.stop();
  await supabase.auth.signOut();
  session = null;
  await wipeLocal();
  location.reload();
}

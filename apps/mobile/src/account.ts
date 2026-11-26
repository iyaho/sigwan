// supabase-js는 URL을 쓴다. RN의 URL은 빠진 데가 있어서 먼저 채운다 (순수 JS — 재빌드 필요 없음)
import 'react-native-url-polyfill/auto';
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
import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';
import { onOutboxWrite } from './db/outboxEvents';
import { getDb, getMeta, resetAll, setMeta } from './db/sqlite';
import { enqueueAll, sqliteSyncLocal } from './db/sync';
import { useStore } from './store';

/**
 * 9.1 계정 + 7장 동기화를 앱에 붙인다. 웹(apps/web/src/lib/account.ts)과 같은 흐름이다.
 *
 * 세션은 expo-sqlite의 키-값 저장소에 둔다. 명세 10장 5번은 Keystore(expo-secure-store)였지만
 * SecureStore는 값 하나가 2KB로 제한이고 Supabase 세션은 그보다 길다. 개인용 앱이고 allowBackup이
 * 꺼져 있어 앱 밖으로 나가지 않는다 — 공개 배포로 바뀌면 다시 본다.
 */

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_KEY,
  { auth: { storage: Storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } },
);

let session: Session | null = null;
const server = createSupabaseServer((fn, args) => supabase.rpc(fn, args));

export const sync = createSyncRunner({
  local: sqliteSyncLocal,
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
  if ((await getMeta(ACCOUNT_KEY)) !== s.user.id) {
    // 9.2.1 — 로그인 전에 쓴 것을 계정에 합친다. 예시는 enqueueAll이 먼저 치운다
    await enqueueAll();
    await setMeta(ACCOUNT_KEY, s.user.id);
    await useStore.getState().load();
  }
  sync.start();
  await sync.syncNow();
}

let initialized = false;

/** 앱을 열 때 한 번. 저장된 세션이 있으면 이어서 동기화한다 */
export async function initAccount() {
  if (initialized) return;
  initialized = true;
  onOutboxWrite(() => {
    if (session) sync.schedule();
  });
  supabase.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === 'SIGNED_OUT') useStore.setState({ account: null });
  });
  // 앱이 앞으로 나올 때 동기화 + 토큰 자동 갱신. 뒤로 가면 갱신을 멈춘다 (Supabase RN 권장)
  AppState.addEventListener('change', (st) => {
    if (st === 'active') {
      supabase.auth.startAutoRefresh();
      void sync.syncNow();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
  const { data } = await supabase.auth.getSession();
  if (data.session) await afterSignIn(data.session);
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
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
  return r?.n ?? 0;
}

/**
 * 로그아웃 — 세션과 이 기기의 데이터를 지운다(9.2.1). 처음처럼 예시가 다시 보인다.
 * 남은 변경을 올려 보는 것은 부르는 쪽(설정 화면)이 확인 창을 띄우기 전에 한다.
 */
export async function signOut() {
  sync.stop();
  await supabase.auth.signOut();
  session = null;
  await resetAll();
  useStore.setState({ account: null, syncStatus: { state: 'off', lastAt: null, error: null } });
  await useStore.getState().load();
}

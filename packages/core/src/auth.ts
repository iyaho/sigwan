/**
 * 9.1 계정 — 자체 아이디 + 비밀번호. 이메일·이름은 받지 않는다.
 * 웹과 앱이 같은 규칙으로 검사하고 같은 문구를 띄운다.
 */

/**
 * Supabase 프로젝트 — **공개 값이다** (부록 A.5). publishable 키는 앱에 들어가는 것이 전제이고,
 * 남의 데이터를 막는 것은 RLS다. secret 키는 여기 절대 두지 않는다.
 * 빌드할 때 환경 변수(VITE_ / EXPO_PUBLIC_)로 덮을 수 있다.
 */
export const SUPABASE_URL = 'https://dqhoxkdzhmqyfquohxao.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8w3LPQUars5szedfCa_JAA_-VdWv2e_';

/** 아이디 → Supabase에 넘기는 내부용 주소. 사용자에게는 보이지 않는다. .invalid라 메일이 갈 곳이 없다 */
export const authEmail = (username: string) => `${normalizeUsername(username)}@users.sigwan.invalid`;

/** 대문자는 소문자로 — `Jinho`와 `jinho`가 다른 계정이 되지 않게 */
export const normalizeUsername = (s: string) => s.trim().toLowerCase();

export function usernameError(s: string): string | null {
  const u = normalizeUsername(s);
  if (u.length < 4 || u.length > 20) return '아이디는 4~20자';
  if (!/^[a-z0-9_]+$/.test(u)) return '아이디는 영문·숫자·_만';
  return null;
}

export function passwordError(p: string): string | null {
  if (p.length < 8) return '비밀번호는 8자 이상';
  if (p.length > 72) return '비밀번호는 72자 이하'; // bcrypt가 그 뒤를 버린다
  return null;
}

/** Supabase Auth 오류 → 화면 문구 (9.1에서 실서버로 확인한 코드) */
export function authErrorMessage(e: { code?: string; message?: string; status?: number }): string {
  switch (e.code) {
    case 'user_already_exists':
      return '이미 있는 아이디다';
    case 'invalid_credentials':
      return '아이디 또는 비밀번호가 틀렸다';
    case 'weak_password':
      return '비밀번호가 너무 약하다';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return '시도가 너무 잦다. 잠시 뒤에 다시';
    case 'signup_disabled':
      return '지금은 가입을 받지 않는다';
  }
  if (!e.status || e.message?.includes('fetch')) return '서버에 닿지 않는다. 인터넷 연결을 확인';
  return e.message ?? '알 수 없는 오류';
}

import { useEffect, useRef, useState } from 'react';
import { pendingCount, signIn, signOut, signUp, sync } from '../lib/account';
import { useStore } from '../store';

/**
 * 9.1 계정 — 사이드바 맨 아래. 게스트면 「로그인 · 가입」, 로그인했으면 아이디와 동기화 상태.
 */
export function AccountFoot() {
  const account = useStore((s) => s.account);
  const st = useStore((s) => s.syncStatus);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await sync.syncNow(); // 남은 변경을 한 번 올려 본다
      const n = await pendingCount();
      const msg =
        '로그아웃하면 이 기기의 데이터를 지운다. 계정(서버)에는 그대로 남아 다시 로그인하면 돌아온다.' +
        (n ? `\n\n⚠ 아직 서버에 못 올린 변경 ${n}개는 사라진다 — 인터넷 연결을 확인하고 다시 시도하는 게 낫다.` : '');
      if (window.confirm(msg)) await signOut();
    } finally {
      setBusy(false);
    }
  }

  if (!account) {
    return (
      <div className="acct">
        <span className="acct-sub">게스트 — 이 기기에만 저장된다</span>
        <button type="button" className="primary-btn primary-btn-sm" onClick={() => setOpen(true)}>
          로그인 · 가입
        </button>
        <AuthDialog open={open} onClose={() => setOpen(false)} />
      </div>
    );
  }

  const label =
    st.state === 'syncing'
      ? '동기화 중…'
      : st.state === 'error'
        ? '오프라인 — 연결되면 올린다'
        : st.lastAt
          ? `동기화됨 ${new Date(st.lastAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
          : '';
  return (
    <div className="acct">
      <span className="acct-name">@{account.username}</span>
      <span className="acct-sub" data-state={st.state} title={st.error ?? undefined}>
        {label}
      </span>
      <button type="button" className="ghost-btn" onClick={() => void logout()} disabled={busy}>
        로그아웃
      </button>
    </div>
  );
}

function AuthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'up' && password !== password2) {
      setError('비밀번호 두 칸이 다르다');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'up') await signUp(username, password);
      else await signIn(username, password);
      setPassword('');
      setPassword2('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="add-dialog acct-dialog" onClose={onClose} onCancel={onClose}>
      <form onSubmit={submit}>
        <header className="add-head">
          <strong>{mode === 'up' ? '가입' : '로그인'}</strong>
          <button type="button" className="ghost-btn" onClick={onClose}>
            닫기 (Esc)
          </button>
        </header>
        <div className="add-body">
          <div className="chips" style={{ marginBottom: 'var(--sp-4)' }}>
            <button type="button" className="chip" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>
              로그인
            </button>
            <button type="button" className="chip" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>
              처음이면 가입
            </button>
          </div>

          <label className="fld">
            <span className="fld-label">아이디</span>
            <input
              className="txt"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="영문·숫자·_ 4~20자"
            />
          </label>
          <label className="fld">
            <span className="fld-label">비밀번호</span>
            <input
              className="txt"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
              placeholder="8자 이상"
            />
          </label>
          {mode === 'up' && (
            <label className="fld">
              <span className="fld-label">비밀번호 확인</span>
              <input
                className="txt"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          )}

          {mode === 'up' ? (
            <p className="hint">
              이메일·이름은 받지 않는다. 그래서 <b>비밀번호를 잊으면 찾을 수 없다.</b>
              <br />이 기기에 쓴 할 일은 계정으로 옮겨진다 — 예시 데이터는 빼고.
            </p>
          ) : (
            <p className="hint">로그인하면 이 기기에 쓴 할 일이 계정의 할 일과 합쳐진다 — 예시 데이터는 빼고.</p>
          )}
          {error && (
            <p className="acct-err" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="add-foot">
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? '잠깐…' : mode === 'up' ? '가입하고 시작' : '로그인'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

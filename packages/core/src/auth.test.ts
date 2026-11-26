import { describe, expect, it } from 'vitest';
import { authEmail, authErrorMessage, passwordError, usernameError } from './auth';

describe('아이디·비밀번호 (9.1)', () => {
  it('아이디는 소문자로 맞춰 내부 주소가 된다', () => {
    expect(authEmail(' Jinho_01 ')).toBe('jinho_01@users.sigwan.invalid');
  });
  it('아이디 규칙 — 4~20자, 영문·숫자·_', () => {
    expect(usernameError('abc')).toBe('아이디는 4~20자');
    expect(usernameError('이진호짱')).toBe('아이디는 영문·숫자·_만');
    expect(usernameError('a.b.c.d')).toBe('아이디는 영문·숫자·_만');
    expect(usernameError('Jinho_01')).toBeNull();
  });
  it('비밀번호는 8~72자', () => {
    expect(passwordError('1234567')).not.toBeNull();
    expect(passwordError('12345678')).toBeNull();
    expect(passwordError('x'.repeat(73))).not.toBeNull();
  });
  it('실서버에서 확인한 오류 코드를 문구로', () => {
    expect(authErrorMessage({ code: 'user_already_exists', status: 422 })).toBe('이미 있는 아이디다');
    expect(authErrorMessage({ code: 'invalid_credentials', status: 400 })).toBe('아이디 또는 비밀번호가 틀렸다');
    expect(authErrorMessage({ message: 'Failed to fetch' })).toContain('서버에 닿지 않는다');
  });
});

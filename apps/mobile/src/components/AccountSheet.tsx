import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { signIn, signUp } from '../account';
import { radius, sp, useTheme } from '../theme';
import { Chip, Field, Row, Sheet } from './Sheet';

/** 9.1 로그인 · 가입 — 아이디와 비밀번호만. 웹의 AuthDialog와 같은 문구 */
export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const th = useTheme();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const input = [styles.input, { borderColor: th.borderStrong, color: th.text, backgroundColor: th.bg }];

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'up' ? '가입' : '로그인'}>
      <Row>
        <Chip label="로그인" on={mode === 'in'} onPress={() => setMode('in')} />
        <Chip label="처음이면 가입" on={mode === 'up'} onPress={() => setMode('up')} />
      </Row>
      <Field label="아이디">
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          placeholder="영문·숫자·_ 4~20자"
          placeholderTextColor={th.textFaint}
          style={input}
        />
      </Field>
      <Field label="비밀번호">
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
          placeholder="8자 이상"
          placeholderTextColor={th.textFaint}
          style={input}
        />
      </Field>
      {mode === 'up' && (
        <Field label="비밀번호 확인">
          <TextInput value={password2} onChangeText={setPassword2} secureTextEntry autoComplete="new-password" style={input} />
        </Field>
      )}
      <Text style={{ color: th.textFaint, fontSize: 12, lineHeight: 17 }}>
        {mode === 'up'
          ? '이메일·이름은 받지 않는다. 그래서 비밀번호를 잊으면 찾을 수 없다.\n이 기기에 쓴 할 일은 계정으로 옮겨진다 — 예시 데이터는 빼고.'
          : '로그인하면 이 기기에 쓴 할 일이 계정의 할 일과 합쳐진다 — 예시 데이터는 빼고.'}
      </Text>
      {error && <Text style={{ color: '#e5484d', fontSize: 13 }}>{error}</Text>}
      <View>
        <Pressable
          onPress={submit}
          disabled={busy}
          style={[styles.submit, { backgroundColor: busy ? th.borderStrong : th.accent }]}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
            {busy ? '잠깐…' : mode === 'up' ? '가입하고 시작' : '로그인'}
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  submit: { borderRadius: radius.md, paddingVertical: sp[3], alignItems: 'center' },
});

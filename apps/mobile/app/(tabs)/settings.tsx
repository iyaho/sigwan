import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pendingCount, signOut, sync } from '@/account';
import { AccountSheet } from '@/components/AccountSheet';
import { TagSheet } from '@/components/TagSheet';
import { resetAll } from '@/db/sqlite';
import { useStore } from '@/store';
import { radius, sp, useTheme } from '@/theme';

/**
 * 설정 탭 (12장) — 계정 · 정렬 · 데이터.
 * 수면·간격·고정 일정은 시간표 탭으로 갔다. 여기서 찾는 사람이 있으니 줄 하나를 남겨 보낸다.
 * 계정은 아이디·비밀번호 하나(9.1). 로그아웃하면 이 기기의 데이터를 지운다(9.2.1).
 */
export default function SettingsScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tasks, tags, routines, settings, load, account, syncStatus } = useStore();
  const [tagSheet, setTagSheet] = useState(false);
  const [accountSheet, setAccountSheet] = useState(false);

  const syncLabel =
    syncStatus.state === 'syncing'
      ? '동기화 중…'
      : syncStatus.state === 'error'
        ? '오프라인 — 연결되면 올린다'
        : syncStatus.lastAt
          ? `동기화됨 ${new Date(syncStatus.lastAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
          : '—';

  async function logout() {
    await sync.syncNow(); // 남은 변경을 한 번 올려 본다
    const n = await pendingCount();
    Alert.alert(
      '로그아웃',
      '이 기기의 데이터를 지운다. 계정(서버)에는 그대로 남아 다시 로그인하면 돌아온다.' +
        (n ? `\n\n아직 서버에 못 올린 변경 ${n}개는 사라진다 — 인터넷 연결을 확인하고 다시 하는 게 낫다.` : ''),
      [
        { text: '취소', style: 'cancel' },
        { text: '로그아웃', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  }

  const Link = ({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={[styles.row, { borderBottomColor: th.border }]}>
      <Text style={{ color: th.text, fontSize: 15 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {value && <Text style={{ color: th.textFaint, fontSize: 13 }}>{value}</Text>}
        <Text style={{ color: th.textFaint, fontSize: 15 }}>›</Text>
      </View>
    </Pressable>
  );

  const InfoRow = ({ label, value }: { label: string; value?: string }) => (
    <View style={[styles.row, { borderBottomColor: th.border }]}>
      <Text style={{ color: th.textFaint, fontSize: 15 }}>{label}</Text>
      {value && <Text style={{ color: th.textFaint, fontSize: 13 }}>{value}</Text>}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + sp[5] * 2 }}>
        <View style={[styles.head, { borderBottomColor: th.border }]}>
          <Text style={[styles.h1, { color: th.text }]}>설정</Text>
        </View>

        <Text style={[styles.section, { color: th.textFaint }]}>할 일</Text>
        <Link label="태그" value={`${tags.length}개`} onPress={() => setTagSheet(true)} />
        <Link
          label="시간표 · 수면"
          value={`${routines.length}개`}
          onPress={() => router.push('/routine')}
        />

        <Text style={[styles.section, { color: th.textFaint }]}>계정</Text>
        {account ? (
          <>
            <InfoRow label={`@${account.username}`} value={syncLabel} />
            <Link label="지금 동기화" onPress={() => void sync.syncNow()} />
            <Link label="로그아웃" value="이 기기의 데이터를 지운다" onPress={() => void logout()} />
          </>
        ) : (
          <>
            <InfoRow label="게스트" value="이 기기에만 저장된다" />
            <Link label="로그인 · 가입" value="PC와 같은 데이터 보기" onPress={() => setAccountSheet(true)} />
          </>
        )}

        <Text style={[styles.section, { color: th.textFaint }]}>정렬</Text>
        <InfoRow
          label="급함 ↔ 중요 가중치"
          value={`${settings.weight_urgent} / ${Math.round((1 - settings.weight_urgent) * 10) / 10}`}
        />
        <InfoRow label="반감 상수" value={`${settings.half_life_hours}h`} />

        <Text style={[styles.section, { color: th.textFaint }]}>데이터</Text>
        <InfoRow label="할 일" value={`${tasks.filter((t) => !t.deleted_at).length}개 · 로컬 SQLite`} />
        <InfoRow label="동기화" value={account ? syncLabel : '로그인하면 켜진다'} />

        {__DEV__ && (
          <Pressable onPress={() => resetAll().then(() => load())} style={[styles.devBtn, { borderColor: th.border }]}>
            <Text style={{ color: th.textFaint, fontSize: 12 }}>dev · 목 데이터 리셋</Text>
          </Pressable>
        )}
      </ScrollView>

      <TagSheet open={tagSheet} onClose={() => setTagSheet(false)} />
      <AccountSheet open={accountSheet} onClose={() => setAccountSheet(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  section: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: sp[4], paddingTop: sp[5], paddingBottom: sp[1] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: sp[4], paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  devBtn: { margin: sp[4], marginTop: sp[5], padding: 10, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, alignItems: 'center' },
});

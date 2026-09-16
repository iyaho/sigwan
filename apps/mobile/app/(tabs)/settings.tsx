import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resetAll } from '@/db/sqlite';
import { useStore } from '@/store';
import { radius, sp, useTheme } from '@/theme';

/**
 * 설정 탭 (12장): 연결된 로그인 수단 · 로그인된 기기 · 계정 삭제 · 가중치 슬라이더.
 * 로그인이 M2라 지금은 자리만. 계정 삭제 자리는 13.6-2 "처음부터" — 위치를 잡아둔다.
 */
export default function SettingsScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const load = useStore((s) => s.load);
  const tasks = useStore((s) => s.tasks);

  const Row = ({ label, value, muted }: { label: string; value?: string; muted?: boolean }) => (
    <View style={[styles.row, { borderBottomColor: th.border }]}>
      <Text style={{ color: muted ? th.textFaint : th.text, fontSize: 15 }}>{label}</Text>
      {value && <Text style={{ color: th.textFaint, fontSize: 13 }}>{value}</Text>}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
      <View style={[styles.head, { borderBottomColor: th.border }]}>
        <Text style={[styles.h1, { color: th.text }]}>설정</Text>
      </View>

      <Text style={[styles.section, { color: th.textFaint }]}>계정</Text>
      <Row label="게스트 모드" value="로그인은 M2" muted />
      <Row label="연결된 로그인 수단" value="—" muted />
      <Row label="로그인된 기기" value="—" muted />
      <Row label="계정 삭제" value="Play 필수 · M2" muted />

      <Text style={[styles.section, { color: th.textFaint }]}>정렬</Text>
      <Row label="급함 ↔ 중요 가중치" value="0.6 / 0.4" muted />
      <Row label="반감 상수" value="48h" muted />

      <Text style={[styles.section, { color: th.textFaint }]}>데이터</Text>
      <Row label="할 일" value={`${tasks.filter((t) => !t.deleted_at).length}개 · 로컬 SQLite`} />

      {__DEV__ && (
        <Pressable
          onPress={() => resetAll().then(() => load())}
          style={[styles.devBtn, { borderColor: th.border }]}
        >
          <Text style={{ color: th.textFaint, fontSize: 12 }}>dev · 목 데이터 리셋</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  section: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: sp[4], paddingTop: sp[5], paddingBottom: sp[1] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: sp[4], paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  devBtn: { margin: sp[4], marginTop: sp[5] * 2, padding: 10, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, alignItems: 'center' },
});

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TagSheet } from '@/components/TagSheet';
import { resetAll } from '@/db/sqlite';
import { useStore } from '@/store';
import { radius, sp, useTheme } from '@/theme';

/**
 * 설정 탭 (12장) — 계정 · 정렬 · 데이터.
 * 수면·간격·고정 일정은 시간표 탭으로 갔다. 여기서 찾는 사람이 있으니 줄 하나를 남겨 보낸다.
 * 계정 삭제 자리는 13.6-2 "처음부터".
 */
export default function SettingsScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tasks, tags, routines, settings, load } = useStore();
  const [tagSheet, setTagSheet] = useState(false);

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
          label="고정 시간표 · 수면"
          value={`${routines.length}개`}
          onPress={() => router.push('/routine')}
        />

        <Text style={[styles.section, { color: th.textFaint }]}>계정</Text>
        <InfoRow label="게스트 모드" value="로그인은 M2" />
        <InfoRow label="연결된 로그인 수단" value="—" />
        <InfoRow label="로그인된 기기" value="—" />
        <InfoRow label="계정 삭제" value="Play 필수 · M2" />

        <Text style={[styles.section, { color: th.textFaint }]}>정렬</Text>
        <InfoRow
          label="급함 ↔ 중요 가중치"
          value={`${settings.weight_urgent} / ${Math.round((1 - settings.weight_urgent) * 10) / 10}`}
        />
        <InfoRow label="반감 상수" value={`${settings.half_life_hours}h`} />

        <Text style={[styles.section, { color: th.textFaint }]}>데이터</Text>
        <InfoRow label="할 일" value={`${tasks.filter((t) => !t.deleted_at).length}개 · 로컬 SQLite`} />
        <InfoRow label="동기화" value="로컬만 · 서버는 M2" />

        {__DEV__ && (
          <Pressable onPress={() => resetAll().then(() => load())} style={[styles.devBtn, { borderColor: th.border }]}>
            <Text style={{ color: th.textFaint, fontSize: 12 }}>dev · 목 데이터 리셋</Text>
          </Pressable>
        )}
      </ScrollView>

      <TagSheet open={tagSheet} onClose={() => setTagSheet(false)} />
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

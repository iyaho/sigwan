import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sp, useTheme } from '@/theme';

/** 타임라인 탭 — 다음 단계. 웹 DayColumns를 gesture-handler + reanimated로 옮긴다 */
export default function TimelineScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
      <View style={[styles.head, { borderBottomColor: th.border }]}>
        <Text style={[styles.h1, { color: th.text }]}>타임라인</Text>
      </View>
      <Text style={{ color: th.textFaint, padding: sp[5], textAlign: 'center', fontSize: 13 }}>
        세로 일 뷰가 여기 들어온다 — 드래그는 UI 스레드에서(reanimated).
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  head: { paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
});

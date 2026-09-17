import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useStore } from '@/store';
import { useTheme } from '@/theme';

export default function RootLayout() {
  const th = useTheme();
  const ready = useStore((s) => s.ready);
  const error = useStore((s) => s.error);
  const load = useStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14, backgroundColor: th.bg }}>
        <Text style={{ color: '#e5484d', fontSize: 17, fontWeight: '700' }}>로컬 DB를 못 열었다</Text>
        <Text selectable style={{ color: th.text, fontSize: 13, lineHeight: 19 }}>
          {error}
        </Text>
        <Text style={{ color: th.textFaint, fontSize: 12, lineHeight: 17 }}>
          스키마가 바뀐 뒤 처음 열 때 나면 설정 → dev 리셋이 답이지만, 지금은 그 화면까지 못 간다.
          앱을 지웠다 다시 깔면 DB가 새로 만들어진다.
        </Text>
        <Pressable
          onPress={() => void load()}
          style={{ borderWidth: 1, borderColor: th.accent, borderRadius: 8, padding: 12, alignItems: 'center' }}
        >
          <Text style={{ color: th.accent, fontWeight: '700' }}>다시 시도</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: th.bg, gap: 12 }}>
        <ActivityIndicator color={th.accent} />
        <Text style={{ color: th.textFaint, fontSize: 12 }}>로컬 DB 여는 중</Text>
      </View>
    );
  }

  return (
    // GestureHandlerRootView가 없으면 제스처가 '조용히' 안 먹는다 — 에러도 안 난다
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: th.bg } }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </GestureHandlerRootView>
  );
}

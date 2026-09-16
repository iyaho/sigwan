import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useStore } from '@/store';
import { useTheme } from '@/theme';

export default function RootLayout() {
  const th = useTheme();
  const ready = useStore((s) => s.ready);
  const load = useStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

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

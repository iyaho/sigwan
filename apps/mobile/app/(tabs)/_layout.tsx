// SDK 57에서 'expo-router'의 Tabs는 deprecated — js-tabs가 현재 경로다
import { Tabs } from 'expo-router/js-tabs';
import { type ColorValue, Text } from 'react-native';
import { useTheme } from '@/theme';

/** 12장 앱 하단 탭 4: 오늘 · 타임라인 · 전체 · 설정. AI(3.7) B안이면 여기가 5개가 된다 */
export default function TabsLayout() {
  const th = useTheme();
  // js-tabs는 color를 ColorValue(OpaqueColorValue 포함)로 준다 — string으로 받으면 타입이 안 맞는다
  const icon =
    (glyph: string) =>
    ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Text style={{ fontSize: 18, color, opacity: focused ? 1 : 0.7 }}>{glyph}</Text>
  );
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: th.accent,
        tabBarInactiveTintColor: th.textFaint,
        tabBarStyle: { backgroundColor: th.panel, borderTopColor: th.border },
        sceneStyle: { backgroundColor: th.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '오늘', tabBarIcon: icon('☀') }} />
      <Tabs.Screen name="timeline" options={{ title: '타임라인', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="all" options={{ title: '전체', tabBarIcon: icon('≡') }} />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}

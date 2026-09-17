// SDK 57에서 'expo-router'의 Tabs는 deprecated — js-tabs가 현재 경로다
import { Tabs } from 'expo-router/js-tabs';
import { type ColorValue, Text } from 'react-native';
import { useTheme } from '@/theme';

/**
 * 12장 앱 하단 탭 4: 일정 · 타임라인 · 시간표 · 설정.
 *
 * '오늘'과 '전체'는 같은 목록에 기간 조건만 다른 것이라 '일정' 하나로 합쳤다(안에서 고른다).
 * 그렇게 비운 자리에 '시간표'(3.8)가 들어왔다.
 *
 * 넷을 유지하는 건 취향이 아니다 — AI(3.7)가 B안(별도 진입점)으로 오면 다섯이 되는데,
 * 하단 탭 다섯부터는 폰에서 글자가 뭉개진다. 여기에 여유가 없다는 걸 알고 정해야 한다.
 */
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
      <Tabs.Screen name="index" options={{ title: '일정', tabBarIcon: icon('≡') }} />
      <Tabs.Screen name="timeline" options={{ title: '타임라인', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="routine" options={{ title: '시간표', tabBarIcon: icon('▦') }} />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}

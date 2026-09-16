import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

/** 12장 — FAB 추가 */
export function Fab({ onPress }: { onPress: () => void }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: th.accent, bottom: insets.bottom + 20, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={styles.plus}>＋</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  plus: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '300' },
});

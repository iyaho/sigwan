import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, sp, useTheme } from '../theme';

/**
 * 하단 시트. RN 기본 Modal만 쓴다 — 시트 라이브러리는 네이티브 모듈이라
 * 넣는 순간 재빌드가 필요해지고, 지금 필요한 건 "올라오는 패널" 하나뿐이다.
 */
export function Sheet({
  open,
  onClose,
  title,
  right,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.wrap}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { backgroundColor: th.panel, paddingBottom: insets.bottom + sp[3] }]}>
          <View style={[styles.grip, { backgroundColor: th.borderStrong }]} />
          <View style={[styles.head, { borderBottomColor: th.border }]}>
            <Text style={[styles.title, { color: th.text }]} numberOfLines={1}>
              {title}
            </Text>
            {right}
            <Pressable onPress={onClose} hitSlop={10} style={[styles.close, { borderColor: th.border }]}>
              <Text style={{ color: th.textDim, fontSize: 12 }}>닫기</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: sp[4], gap: sp[4] }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** 라벨 + 내용 한 덩어리 */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const th = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 11, color: th.textFaint, letterSpacing: 0.4 }}>{label}</Text>
      {children}
      {hint && <Text style={{ fontSize: 11, color: th.textFaint }}>{hint}</Text>}
    </View>
  );
}

/** 3.3-2 — 칩으로 탭 한 번에 정해지는 것들 */
export function Chip({
  label,
  on,
  onPress,
  dot,
  small,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  dot?: string;
  small?: boolean;
}) {
  const th = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        small && styles.chipSm,
        { borderColor: on ? th.accent : th.borderStrong, backgroundColor: on ? th.accent : th.bg },
      ]}
    >
      {dot && <View style={[styles.dot, { backgroundColor: dot }]} />}
      <Text style={{ fontSize: small ? 12 : 13, color: on ? '#fff' : th.textDim, fontWeight: on ? '600' : '400' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export const Row = ({ children }: { children: ReactNode }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{children}</View>
);

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.38)' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: radius.lg + 6, borderTopRightRadius: radius.lg + 6 },
  grip: { width: 36, height: 4, borderRadius: 999, alignSelf: 'center', marginTop: sp[2] },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp[2], padding: sp[4], paddingBottom: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 17, fontWeight: '700' },
  close: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 5 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  chipSm: { paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 999 },
});

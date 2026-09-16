import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMeta, setMeta } from '../db/sqlite';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';

/**
 * 12장 온보딩 — 3화면 이하, 게스트 모드로 바로 쓴다.
 *
 * 로그인은 M2라 여기서 계정을 만들라고 하지 않는다. 명세가 "첫 실행은 로그인 없이"라고
 * 못 박은 이유가 그거고, 지금 로그인 화면을 넣으면 M2에서 통째로 다시 짠다.
 *
 * 마지막 장은 안내가 아니라 행동이다 — 첫 할 일을 여기서 만든다.
 * "나중에 해보세요"로 끝나는 온보딩은 아무도 안 돌아온다.
 */
const KEY = 'onboarded';

const PAGES = [
  {
    badge: '급한 순',
    title: '무엇부터 할지는\n앱이 정한다',
    body: '남은 시간이 아니라 여유로 센다. 사흘 남았지만 20시간 걸리는 일이 내일 마감 10분짜리보다 급하다. 줄 왼쪽 색이 그 등급이다.',
  },
  {
    badge: '할 일과 시간',
    title: '할 일을 시간표에\n올려둔다',
    body: '타임라인 빈 곳을 길게 누르면 그 시각에 할 일을 잡는다. 블록은 길게 눌러 끌면 옮겨지고, 아래끝을 끌면 길어진다.',
  },
  {
    badge: '지금 시작',
    title: '첫 할 일을\n하나 적어보자',
    body: '필요한 건 제목 하나. 나머지는 기본값이 있고, 저장하기 전에 이게 몇 번째로 급한지 미리 보여준다.',
    cta: '할 일 추가',
  },
];

export function Onboarding({ onAddTask }: { onAddTask: () => void }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const ready = useStore((s) => s.ready);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!ready) return;
    void getMeta(KEY).then((v) => {
      if (!v) setOpen(true);
    });
  }, [ready]);

  const close = async (thenAdd: boolean) => {
    setOpen(false);
    await setMeta(KEY, new Date().toISOString());
    if (thenAdd) onAddTask();
  };

  if (!open) return null;
  const p = PAGES[i] as (typeof PAGES)[number];
  const last = i === PAGES.length - 1;

  return (
    <Modal visible animationType="fade" onRequestClose={() => close(false)}>
      <View style={[styles.wrap, { backgroundColor: th.bg, paddingTop: insets.top + sp[5], paddingBottom: insets.bottom + sp[4] }]}>
        <Pressable onPress={() => close(false)} style={styles.skip} hitSlop={10}>
          <Text style={{ color: th.textFaint, fontSize: 13 }}>건너뛰기</Text>
        </Pressable>

        <View style={{ flex: 1, justifyContent: 'center', gap: sp[4] }}>
          <View style={[styles.badge, { backgroundColor: th.accentSoft }]}>
            <Text style={{ color: th.accent, fontSize: 12, fontWeight: '700' }}>{p.badge}</Text>
          </View>
          <Text style={[styles.title, { color: th.text }]}>{p.title}</Text>
          <Text style={[styles.body, { color: th.textDim }]}>{p.body}</Text>
        </View>

        <View style={styles.dots}>
          {PAGES.map((x, n) => (
            <View
              key={x.badge}
              style={[styles.dot, { backgroundColor: n === i ? th.accent : th.border, width: n === i ? 18 : 6 }]}
            />
          ))}
        </View>

        <Pressable
          onPress={() => (last ? close(true) : setI(i + 1))}
          style={[styles.next, { backgroundColor: th.accent }]}
        >
          <Text style={styles.nextText}>{last ? p.cta : '다음'}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: sp[5] },
  skip: { alignSelf: 'flex-end', padding: sp[2] },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  title: { fontSize: 30, fontWeight: '700', lineHeight: 40, letterSpacing: -0.5 },
  body: { fontSize: 15, lineHeight: 23 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: sp[4] },
  dot: { height: 6, borderRadius: 999 },
  next: { paddingVertical: 15, borderRadius: radius.md, alignItems: 'center' },
  nextText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

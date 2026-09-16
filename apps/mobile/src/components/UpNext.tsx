import { GRADE_COLOR, priorityScore } from '@sigwan/core';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';

/**
 * 12장 "오늘 = 블록 타임라인 + 할 일 리스트"의 블록 쪽.
 *
 * 세로 타임라인을 리스트 위에 얹으면 스크롤이 두 겹이 되어 폰에서 못 쓴다.
 * 그래서 지금~6시간을 가로 스트립으로 편다 — 명세 3.5의 '다음 일정' 위젯과 같은 범위라
 * M4에서 이 코드가 위젯 레이아웃의 초안이 된다.
 */
const WINDOW_H = 6;

export function UpNext({ onOpenTimeline }: { onOpenTimeline: () => void }) {
  const th = useTheme();
  const { blocks, tasks, select } = useStore();
  const now = new Date();

  const items = useMemo(() => {
    const from = now.getTime();
    const to = from + WINDOW_H * 3600_000;
    return blocks
      .filter((b) => !b.deleted_at && Date.parse(b.end_at) > from && Date.parse(b.start_at) < to)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  }, [blocks, now]);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  return (
    <View style={{ gap: 6 }}>
      <View style={styles.head}>
        <Text style={[styles.label, { color: th.textFaint }]}>지금부터 {WINDOW_H}시간</Text>
        <Pressable onPress={onOpenTimeline} hitSlop={8}>
          <Text style={{ color: th.accent, fontSize: 12 }}>타임라인 ›</Text>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <Pressable onPress={onOpenTimeline} style={[styles.empty, { borderColor: th.border }]}>
          <Text style={{ color: th.textFaint, fontSize: 12 }}>
            잡힌 블록이 없다 — 타임라인에서 길게 눌러 시간을 잡는다
          </Text>
        </Pressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {items.map((b) => {
            const task = b.task_id ? taskById.get(b.task_id) : undefined;
            const isEvent = !task;
            const color = task ? GRADE_COLOR[priorityScore(task, now).grade] : th.borderStrong;
            const running = Date.parse(b.start_at) <= now.getTime();
            return (
              <Pressable
                key={b.id}
                onPress={() => (b.task_id ? select(b.task_id) : onOpenTimeline())}
                style={[
                  styles.card,
                  {
                    backgroundColor: th.panel,
                    borderColor: running ? color : th.border,
                    borderStyle: isEvent ? 'dashed' : 'solid',
                  },
                ]}
              >
                <View style={[styles.bar, { backgroundColor: color }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.time, { color: running ? color : th.textDim }]}>
                    {running ? '진행 중' : fmt(b.start_at)}
                    <Text style={{ color: th.textFaint }}> · {dur(b.start_at, b.end_at)}</Text>
                  </Text>
                  <Text style={[styles.title, { color: th.text }]} numberOfLines={2}>
                    {task?.title ?? b.title}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function fmt(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function dur(a: string, b: string) {
  const m = Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
  return m >= 60 ? `${(m / 60).toFixed(m % 60 ? 1 : 0)}시간` : `${m}분`;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: sp[4] },
  label: { fontSize: 11, letterSpacing: 0.4 },
  strip: { paddingHorizontal: sp[4], gap: sp[2] },
  card: { flexDirection: 'row', gap: sp[2], width: 168, borderWidth: 1, borderRadius: radius.md, padding: sp[2], alignItems: 'stretch' },
  bar: { width: 3, borderRadius: 999 },
  time: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  title: { fontSize: 13, marginTop: 2, lineHeight: 17 },
  empty: { marginHorizontal: sp[4], borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, padding: sp[3], alignItems: 'center' },
});

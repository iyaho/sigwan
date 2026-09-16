import type { Tag, Task } from '@sigwan/core';
import { GRADE_COLOR, priorityScore } from '@sigwan/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, sp, useTheme } from '../theme';

/** 리스트 한 줄. 왼쪽 스트라이프 = 등급색 (4장). 웹 .task와 같은 정보. */
export function TaskRow({
  task,
  tags,
  onToggle,
  onPress,
}: {
  task: Task;
  tags: Tag[];
  onToggle: () => void;
  onPress: () => void;
}) {
  const th = useTheme();
  const s = priorityScore(task);
  const done = task.status === 'done';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: th.border, backgroundColor: pressed ? th.sunken : 'transparent' },
      ]}
    >
      <View style={[styles.stripe, { backgroundColor: GRADE_COLOR[s.grade] }]} />
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        style={[styles.check, { borderColor: th.borderStrong, backgroundColor: done ? th.accent : 'transparent' }]}
      >
        {done && <Text style={styles.checkMark}>✓</Text>}
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[styles.title, { color: done ? th.textFaint : th.text }, done && styles.done]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        <View style={styles.meta}>
          {task.due_at && <Text style={[styles.metaText, { color: th.textFaint }]}>{fmtDue(task.due_at)}</Text>}
          {task.day_of && !task.due_at && <Text style={[styles.metaText, { color: th.textFaint }]}>{task.day_of}</Text>}
          <Text style={[styles.metaText, { color: th.textFaint }]}>{fmtEst(task.estimate_min)}</Text>
          <Text style={[styles.metaText, { color: th.textFaint }]}>중요도 {task.importance}</Text>
          {task.pinned && <Text style={styles.metaText}>📌</Text>}
          {tags.map((t) => (
            <View key={t.id} style={[styles.chip, { backgroundColor: th.sunken }]}>
              <View style={[styles.dot, { backgroundColor: t.color }]} />
              <Text style={[styles.chipText, { color: th.textDim }]}>{t.name}</Text>
            </View>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

function fmtEst(min: number) {
  return min >= 60 ? `${(min / 60).toFixed(min % 60 ? 1 : 0)}h` : `${min}m`;
}
function fmtDue(iso: string) {
  const d = new Date(iso);
  const past = d.getTime() < Date.now();
  const s = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return past ? `${s} 지남` : s;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: sp[3], paddingVertical: 10, paddingRight: sp[4], borderBottomWidth: StyleSheet.hairlineWidth },
  stripe: { width: 3, alignSelf: 'stretch', borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  check: { width: 22, height: 22, borderRadius: radius.sm + 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 16 },
  title: { fontSize: 15, lineHeight: 20 },
  done: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3, alignItems: 'center' },
  metaText: { fontSize: 12, lineHeight: 17 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999 },
  dot: { width: 6, height: 6, borderRadius: 999 },
  chipText: { fontSize: 11, lineHeight: 16 },
});

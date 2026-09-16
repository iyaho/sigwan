import { sortByPriority } from '@sigwan/core';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddTaskSheet } from '@/components/AddTaskSheet';
import { Fab } from '@/components/Fab';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { TaskRow } from '@/components/TaskRow';
import { useStore } from '@/store';
import { sp, useTheme } from '@/theme';
import { todayProgress, todayTasks } from '@/views';

/**
 * 오늘 탭 — 기본 화면 (12장). M3 1차: 급한 순 리스트 + 진행도.
 * 블록 타임라인(오늘 일정)과 FAB 추가 폼은 다음 단계.
 */
export default function TodayScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { tasks, tags, taskTags, toggleDone, select } = useStore();
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(() => sortByPriority(todayTasks(tasks)), [tasks]);
  const prog = useMemo(() => todayProgress(tasks), [tasks]);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const today = new Date();
  const label = today.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  return (
    <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
      <View style={[styles.head, { borderBottomColor: th.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: th.text }]}>오늘</Text>
          <Text style={[styles.sub, { color: th.textFaint }]}>{label}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={[styles.pct, { color: th.text }]}>{pct}%</Text>
          <View style={[styles.bar, { backgroundColor: th.sunken }]}>
            <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: th.accent }]} />
          </View>
          <Text style={[styles.sub, { color: th.textFaint }]}>
            {prog.done}/{prog.total} 완료
          </Text>
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <TaskRow
            task={item}
            tags={(taskTags[item.id] ?? []).map((id) => tagById.get(id)).filter((x): x is NonNullable<typeof x> => !!x)}
            onToggle={() => toggleDone(item.id)}
            onPress={() => select(item.id)}
          />
        )}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: th.textFaint }]}>오늘은 비어 있다.</Text>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
      />

      <Fab onPress={() => setAddOpen(true)} />
      <AddTaskSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <TaskDetailSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth, gap: sp[3] },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  sub: { fontSize: 12, marginTop: 2 },
  pct: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bar: { width: 96, height: 6, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  empty: { textAlign: 'center', padding: sp[5], fontSize: 13 },
});

import { sortByPriority } from '@sigwan/core';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddTaskSheet } from '@/components/AddTaskSheet';
import { Fab } from '@/components/Fab';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { TaskRow } from '@/components/TaskRow';
import { useStore } from '@/store';
import { sp, useTheme } from '@/theme';

/** 전체 탭 — 급한 순 + 태그 칩 필터 (12장) */
export default function AllScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { tasks, tags, taskTags, toggleDone, select } = useStore();
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(() => {
    let list = tasks.filter((t) => !t.deleted_at && t.status !== 'done' && t.kind !== 'someday');
    if (tagFilter.length) list = list.filter((t) => (taskTags[t.id] ?? []).some((id) => tagFilter.includes(id)));
    return sortByPriority(list);
  }, [tasks, taskTags, tagFilter]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  return (
    <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
      <View style={[styles.head, { borderBottomColor: th.border }]}>
        <Text style={[styles.h1, { color: th.text }]}>전체</Text>
        <Text style={[styles.sub, { color: th.textFaint }]}>급한 순 · {rows.length}개</Text>
      </View>
      {/* 필터 줄은 가로 스크롤이면 8개 중 4개만 보이고 나머지는 잘린다 —
          숨은 선택지는 없는 선택지다. 줄바꿈으로 전부 보여준다. */}
      <View style={styles.chips}>
        {tagFilter.length > 0 && (
          <Pressable
            onPress={() => setTagFilter([])}
            style={[styles.chip, { borderColor: th.borderStrong, backgroundColor: th.panel }]}
          >
            <Text style={{ fontSize: 12, color: th.textDim }}>✕ 초기화</Text>
          </Pressable>
        )}
        {tags.map((t) => {
          const on = tagFilter.includes(t.id);
          return (
            <Pressable
              key={t.id}
              onPress={() => setTagFilter((f) => (on ? f.filter((x) => x !== t.id) : [...f, t.id]))}
              style={[styles.chip, { borderColor: on ? th.accent : th.borderStrong, backgroundColor: on ? th.accentSoft : th.panel }]}
            >
              <View style={[styles.dot, { backgroundColor: t.color }]} />
              <Text style={[styles.chipText, { color: on ? th.accent : th.textDim }]}>{t.name}</Text>
            </Pressable>
          );
        })}
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
      />

      <Fab onPress={() => setAddOpen(true)} />
      <AddTaskSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <TaskDetailSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  sub: { fontSize: 12, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: sp[4], paddingVertical: sp[2], gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  // 안드로이드는 lineHeight가 없으면 한글 받침이 잘린다. fontSize의 1.4배가 안전선.
  chipText: { fontSize: 12, lineHeight: 17 },
  dot: { width: 7, height: 7, borderRadius: 999 },
});

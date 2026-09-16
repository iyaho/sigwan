import type { Block, Tag, Task } from '@sigwan/core';
import { GRADE_COLOR, blocksOnDay, priorityScore, sortByPriority, tasksOnDay } from '@sigwan/core';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';

/**
 * 선택한 날의 목록. 두 덩어리로 나뉜다 — 이 구분이 이 화면의 전부다.
 *
 *   잡은 시간   그 날의 Block  (언제 할지 정해진 것)
 *   안 잡은 것  그 날 마감인데 Block이 없는 Task
 *
 * 명세 2장이 Task와 Block을 나눈 이유가 여기서 눈에 보인다. 둘을 섞어 한 줄로 그리면
 * "할 일은 있는데 시간은 안 잡았다"가 안 보이고, 그게 이 앱이 잡으려는 상태다.
 */
export function DayAgenda({ day, onPickSlot }: { day: Date; onPickSlot?: (at: Date) => void }) {
  const th = useTheme();
  const { tasks, blocks, tags, taskTags, toggleDone, select } = useStore();

  const { scheduled, unscheduled } = useMemo(() => {
    const dayBlocks = blocksOnDay(blocks, day);
    const withBlock = new Set(dayBlocks.map((b: Block) => b.task_id).filter(Boolean));
    const open = tasksOnDay(tasks, day).filter((t: Task) => t.status !== 'done');
    return {
      scheduled: dayBlocks,
      unscheduled: sortByPriority(open.filter((t: Task) => !withBlock.has(t.id))),
    };
  }, [tasks, blocks, day]);

  const taskById = useMemo(() => new Map(tasks.map((t: Task) => [t.id, t])), [tasks]);
  const tagById = useMemo(() => new Map(tags.map((t: Tag) => [t.id, t])), [tags]);

  const hhmm = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const dur = (b: Block) => {
    const m = (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000;
    return m >= 60 ? `${Math.round((m / 60) * 10) / 10}시간` : `${Math.round(m)}분`;
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
      <Text style={[styles.section, { color: th.textFaint }]}>
        잡은 시간 {scheduled.length > 0 ? `· ${scheduled.length}개` : ''}
      </Text>
      {scheduled.length === 0 ? (
        <Text style={[styles.empty, { color: th.textFaint }]}>이 날은 아직 아무것도 안 잡혀 있다.</Text>
      ) : (
        scheduled.map((b: Block) => {
          const t = b.task_id ? taskById.get(b.task_id) : undefined;
          const grade = t ? GRADE_COLOR[priorityScore(t).grade] : th.textFaint;
          return (
            <Pressable
              key={b.id}
              onPress={() => t && select(t.id)}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: th.border, backgroundColor: pressed ? th.sunken : 'transparent' },
              ]}
            >
              <View style={[styles.stripe, { backgroundColor: grade }]} />
              <Text style={[styles.time, { color: th.textDim }]}>{hhmm(b.start_at)}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.title, { color: th.text }]} numberOfLines={1}>
                  {t?.title ?? b.title ?? '(제목 없음)'}
                </Text>
                <Text style={[styles.meta, { color: th.textFaint }]}>
                  {hhmm(b.start_at)}–{hhmm(b.end_at)} · {dur(b)}
                  {t && t.estimate_min > 0
                    ? ` / 예상 ${t.estimate_min >= 60 ? `${Math.round((t.estimate_min / 60) * 10) / 10}시간` : `${t.estimate_min}분`}`
                    : ''}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}

      <Text style={[styles.section, { color: th.textFaint }]}>
        시간 안 잡음 {unscheduled.length > 0 ? `· ${unscheduled.length}개` : ''}
      </Text>
      {unscheduled.length === 0 ? (
        <Text style={[styles.empty, { color: th.textFaint }]}>이 날 마감인 것은 전부 시간이 잡혀 있다.</Text>
      ) : (
        unscheduled.map((t: Task) => {
          const s = priorityScore(t);
          return (
            <Pressable
              key={t.id}
              onPress={() => select(t.id)}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: th.border, backgroundColor: pressed ? th.sunken : 'transparent' },
              ]}
            >
              <View style={[styles.stripe, { backgroundColor: GRADE_COLOR[s.grade] }]} />
              <Pressable
                onPress={() => toggleDone(t.id)}
                hitSlop={10}
                style={[styles.check, { borderColor: th.borderStrong }]}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.title, { color: th.text }]} numberOfLines={1}>
                  {t.title}
                </Text>
                <View style={styles.tagRow}>
                  <Text style={[styles.meta, { color: th.textFaint }]}>
                    예상{' '}
                    {t.estimate_min >= 60
                      ? `${Math.round((t.estimate_min / 60) * 10) / 10}시간`
                      : `${t.estimate_min}분`}{' '}
                    · 중요도 {t.importance}
                  </Text>
                  {(taskTags[t.id] ?? []).map((id: string) => {
                    const tag = tagById.get(id);
                    return tag ? (
                      <View key={id} style={[styles.chip, { backgroundColor: th.sunken }]}>
                        <View style={[styles.dot, { backgroundColor: tag.color }]} />
                        <Text style={[styles.chipText, { color: th.textDim }]}>{tag.name}</Text>
                      </View>
                    ) : null;
                  })}
                </View>
              </View>
              {onPickSlot && (
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    const at = new Date(day);
                    at.setHours(9, 0, 0, 0);
                    onPickSlot(at);
                  }}
                  style={[styles.pick, { borderColor: th.borderStrong }]}
                >
                  <Text style={{ color: th.textDim, fontSize: 11 }}>시간 잡기</Text>
                </Pressable>
              )}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.6,
    paddingHorizontal: sp[4],
    paddingTop: sp[4],
    paddingBottom: sp[1],
  },
  empty: { fontSize: 12, lineHeight: 17, paddingHorizontal: sp[4], paddingVertical: sp[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp[3],
    paddingVertical: 10,
    paddingRight: sp[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stripe: { width: 3, alignSelf: 'stretch', borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  time: { fontSize: 12, lineHeight: 17, width: 40, fontVariant: ['tabular-nums'] },
  check: { width: 20, height: 20, borderRadius: radius.sm + 2, borderWidth: 1.5 },
  title: { fontSize: 14, lineHeight: 19 },
  meta: { fontSize: 11, lineHeight: 16 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999 },
  chipText: { fontSize: 11, lineHeight: 16 },
  dot: { width: 6, height: 6, borderRadius: 999 },
  pick: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 4 },
});

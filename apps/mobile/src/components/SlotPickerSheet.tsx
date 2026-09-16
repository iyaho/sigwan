import type { Task } from '@sigwan/core';
import {
  FIT_LIMIT_LABEL,
  GRADE_COLOR,
  MIN_SESSION_MIN,
  fitBlock,
  fitSummary,
  nextFreeSlot,
  priorityScore,
  remainingToSchedule,
  sortByPriority,
} from '@sigwan/core';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtEst } from '../dateChips';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';
import { Sheet } from './Sheet';

/**
 * 3.2의 "인박스 → 타임라인 드롭 = Block 생성"의 모바일판.
 *
 * 화면 사이를 가로지르는 드래그는 폰에서 성립하지 않는다(리스트와 타임라인이 다른 탭이다).
 * 그래서 방향을 뒤집었다 — 타임라인의 빈 곳을 길게 누르면 그 시각이 정해지고,
 * 아직 시간을 안 잡은 할 일 중에서 고른다. 결과는 같은 Block 하나다.
 *
 * 누르기 전에 **실제로 몇 시간이 잡히는지** 보여준다. 20시간짜리를 눌렀는데 4시간만
 * 들어가는 걸 나중에 알면 그건 버그로 보인다 — 먼저 말해주면 그냥 규칙이다.
 */
export function SlotPickerSheet({ at, onClose }: { at: Date | null; onClose: () => void }) {
  const th = useTheme();
  const { tasks, blocks, scheduleTask } = useStore();

  const rows = useMemo(() => {
    if (!at) return [];
    const scheduled = new Set(blocks.filter((b) => !b.deleted_at && b.task_id).map((b) => b.task_id));
    const open = tasks.filter((t) => !t.deleted_at && t.status !== 'done');
    // 미스케줄이 먼저, 그 다음 이미 블록이 있는 것 (하루에 두 번 잡을 수도 있다)
    const un = open.filter((t) => !scheduled.has(t.id));
    const already = open.filter((t) => scheduled.has(t.id));
    return [...sortByPriority(un), ...sortByPriority(already)].map((t) => {
      const want = remainingToSchedule(t, blocks) || Math.max(t.estimate_min, MIN_SESSION_MIN);
      const fit = fitBlock({ start: at, wantMinutes: want, existing: blocks });
      return { task: t, want, fit, already: scheduled.has(t.id) };
    });
  }, [tasks, blocks, at]);

  const alt = useMemo(
    () => (at ? nextFreeSlot(at, MIN_SESSION_MIN, blocks) : null),
    [at, blocks],
  );

  if (!at) return null;

  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const label = `${at.getMonth() + 1}/${at.getDate()} ${hhmm(at)}`;
  const blocked = rows.length > 0 && rows.every((r) => r.fit.tooSmall);

  return (
    <Sheet open onClose={onClose} title={`${label}에 잡기`}>
      {rows.length === 0 ? (
        <Text style={[styles.empty, { color: th.textFaint }]}>잡을 할 일이 없다.</Text>
      ) : blocked ? (
        <Text style={[styles.empty, { color: th.textFaint }]}>
          여기는 {MIN_SESSION_MIN}분도 안 남았다.
          {alt ? ` ${hhmm(alt)}부터 비어 있다.` : ' 오늘은 자리가 없다.'}
        </Text>
      ) : (
        <View style={{ gap: 2 }}>
          {rows.map(({ task: t, want, fit, already }: (typeof rows)[number]) => {
            const s = priorityScore(t as Task);
            return (
              <Pressable
                key={t.id}
                disabled={fit.tooSmall}
                onPress={async () => {
                  await scheduleTask(t.id, at);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderBottomColor: th.border,
                    backgroundColor: pressed ? th.sunken : 'transparent',
                    opacity: fit.tooSmall ? 0.4 : 1,
                  },
                ]}
              >
                <View style={[styles.stripe, { backgroundColor: GRADE_COLOR[s.grade] }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.title, { color: th.text }]} numberOfLines={1}>
                    {t.title}
                  </Text>
                  <Text style={[styles.meta, { color: th.textFaint }]} numberOfLines={1}>
                    {fit.tooSmall
                      ? `자리가 ${fit.minutes}분뿐`
                      : fitSummary(fit, want)}
                    {fit.truncated && !fit.tooSmall ? ` · ${FIT_LIMIT_LABEL[fit.limitedBy]}` : ''}
                  </Text>
                  <Text style={[styles.sub, { color: th.textFaint }]} numberOfLines={1}>
                    예상 {fmtEst(t.estimate_min)} · 중요도 {t.importance}
                    {already ? ' · 이미 잡힘' : ''}
                  </Text>
                </View>
                <Text style={{ color: th.textFaint, fontSize: 16 }}>＋</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp[3],
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
  },
  stripe: { width: 3, alignSelf: 'stretch', borderRadius: 999 },
  title: { fontSize: 14, lineHeight: 19 },
  meta: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  sub: { fontSize: 11, lineHeight: 16 },
  empty: { fontSize: 13, lineHeight: 19, textAlign: 'center', padding: sp[4] },
});

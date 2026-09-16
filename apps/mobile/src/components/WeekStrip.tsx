import type { Task } from '@sigwan/core';
import {
  GRADE_COLOR,
  WEEKDAY_KO,
  addDays,
  blocksOnDay,
  priorityScore,
  sameDay,
  startOfWeek,
  tasksOnDay,
} from '@sigwan/core';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';

/**
 * 주 뷰 상단 — 월~일 7칸.
 *
 * 세로 7열 간트를 폰에 넣으면 열 하나가 49px이라 막대가 어디 있는지만 보이고 무엇인지는
 * 안 보인다(명세 3.1이 "주 뷰 2시간 = 4.8px"로 한 번 걸렸던 것과 같은 함정이다).
 * 그래서 주는 타임라인을 포기하고 "어느 날이 찼나"만 답한다. 무엇인지는 아래 리스트가 답한다.
 *
 * 칸마다 점 최대 3개 = 그 날 잡힌 블록 수, 색 = 그 날 가장 급한 할 일의 등급.
 * 점이 없으면 비어 있는 날이다 — 눌러보지 않아도 보이는 게 요점이다.
 */
export function WeekStrip({
  weekStart,
  selected,
  onSelect,
}: {
  weekStart: Date;
  selected: Date;
  onSelect: (d: Date) => void;
}) {
  const th = useTheme();
  const { tasks, blocks } = useStore();
  const today = new Date();

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(startOfWeek(weekStart), i);
      const dayTasks = tasksOnDay(tasks, d);
      const open = dayTasks.filter((t: Task) => t.status !== 'done');
      const top = open.length
        ? open.reduce((best: Task, t: Task) =>
            priorityScore(t).score > priorityScore(best).score ? t : best,
          )
        : null;
      return {
        date: d,
        blockCount: blocksOnDay(blocks, d).length,
        openCount: open.length,
        color: top ? GRADE_COLOR[priorityScore(top).grade] : null,
      };
    });
  }, [weekStart, tasks, blocks]);

  return (
    <View style={styles.strip}>
      {days.map((d) => {
        const on = sameDay(d.date, selected);
        const isToday = sameDay(d.date, today);
        return (
          <Pressable
            key={d.date.toISOString()}
            onPress={() => onSelect(d.date)}
            style={[
              styles.cell,
              {
                backgroundColor: on ? th.accentSoft : 'transparent',
                borderColor: on ? th.accent : 'transparent',
              },
            ]}
          >
            <Text style={[styles.wd, { color: on ? th.accent : th.textFaint }]}>
              {WEEKDAY_KO[(d.date.getDay() + 6) % 7]}
            </Text>
            <Text
              style={[
                styles.num,
                { color: on ? th.accent : isToday ? th.nowLine : th.text },
                isToday && styles.todayNum,
              ]}
            >
              {d.date.getDate()}
            </Text>
            <View style={styles.dots}>
              {d.blockCount === 0 && d.openCount === 0 ? (
                <View style={[styles.dot, { backgroundColor: 'transparent' }]} />
              ) : (
                Array.from({ length: Math.min(3, Math.max(d.blockCount, 1)) }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: d.color ?? th.textFaint,
                        opacity: d.blockCount === 0 ? 0.35 : 1,
                      },
                    ]}
                  />
                ))
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', paddingHorizontal: sp[2], paddingBottom: sp[2], gap: 2 },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  wd: { fontSize: 10, lineHeight: 14 },
  num: { fontSize: 16, lineHeight: 21, fontVariant: ['tabular-nums'] },
  todayNum: { fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 2, height: 5, alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 999 },
});

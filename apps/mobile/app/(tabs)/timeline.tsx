import { ZOOMS } from '@sigwan/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddTaskSheet } from '@/components/AddTaskSheet';
import { DayTimeline } from '@/components/DayTimeline';
import { Fab } from '@/components/Fab';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { useStore } from '@/store';
import { radius, sp, useTheme } from '@/theme';
import { rangeProgressOf } from '@/views';

/** 타임라인 탭 — 하루 세로 뷰. 주/월은 웹에서 보는 게 낫다(12장: 앱은 일 중심) */
export default function TimelineScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { blocks, tasks } = useStore();
  const [day, setDay] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [addOpen, setAddOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const isToday = day.toDateString() === now.toDateString();
  const nowY = ((now.getHours() * 60 + now.getMinutes()) * ZOOMS.day.pxPerMinute);

  // 열 때 지금 시각(오늘이 아니면 09:00)으로 스크롤
  useEffect(() => {
    const y = isToday ? nowY - 140 : 9 * 60 * ZOOMS.day.pxPerMinute - 40;
    const t = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false }), 50);
    return () => clearTimeout(t);
  }, [day, isToday, nowY]);

  const dayBlocks = useMemo(() => {
    const s = day.getTime();
    const e = s + 864e5;
    return blocks.filter((b) => !b.deleted_at && Date.parse(b.end_at) > s && Date.parse(b.start_at) < e);
  }, [blocks, day]);

  const prog = useMemo(() => rangeProgressOf(tasks, day, new Date(day.getTime() + 864e5)), [tasks, day]);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : null;

  const shift = (n: number) => {
    const d = new Date(day);
    d.setDate(d.getDate() + n);
    setDay(d);
  };

  const planned = dayBlocks.reduce((m, b) => m + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000, 0);

  return (
    <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
      <View style={[styles.head, { borderBottomColor: th.border }]}>
        <View style={styles.nav}>
          <Pressable onPress={() => shift(-1)} style={[styles.navBtn, { borderColor: th.border }]} hitSlop={6}>
            <Text style={{ color: th.textDim }}>◀</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const d = new Date();
              d.setHours(0, 0, 0, 0);
              setDay(d);
            }}
            style={[styles.navBtn, { borderColor: th.border }]}
          >
            <Text style={{ color: th.textDim, fontSize: 12 }}>오늘</Text>
          </Pressable>
          <Pressable onPress={() => shift(1)} style={[styles.navBtn, { borderColor: th.border }]} hitSlop={6}>
            <Text style={{ color: th.textDim }}>▶</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: th.text }]}>
            {day.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
          </Text>
          <Text style={{ color: th.textFaint, fontSize: 11, marginTop: 2 }}>
            블록 {dayBlocks.length}개 · {Math.round((planned / 60) * 10) / 10}시간 잡힘
            {pct !== null ? ` · 마감 ${pct}%` : ''}
          </Text>
        </View>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
        <View>
          <DayTimeline day={day} />
          {isToday && (
            <View pointerEvents="none" style={[styles.nowLine, { top: nowY, borderTopColor: th.nowLine }]}>
              <View style={[styles.nowBadge, { backgroundColor: th.nowLine }]}>
                <Text style={styles.nowText}>
                  {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
                </Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <Text style={[styles.hint, { color: th.textFaint, bottom: insets.bottom + 8 }]}>
        길게 눌러 끌면 이동 · 아래끝 손잡이로 길이 조절 · 15분 스냅
      </Text>

      <Fab onPress={() => setAddOpen(true)} />
      <AddTaskSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <TaskDetailSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  nav: { flexDirection: 'row', gap: 4 },
  navBtn: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  h1: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  nowLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, zIndex: 20 },
  nowBadge: { position: 'absolute', left: 4, top: -9, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.sm },
  nowText: { color: '#fff', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { position: 'absolute', left: 0, right: 90, textAlign: 'center', fontSize: 10 },
});

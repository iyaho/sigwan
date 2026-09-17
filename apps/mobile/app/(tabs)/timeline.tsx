import { addDays, checkKey, rangeProgress, routineOccurrences, startOfDay, startOfWeek, ymd, ZOOMS } from '@sigwan/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddTaskSheet } from '@/components/AddTaskSheet';
import { AutoScheduleSheet } from '@/components/AutoScheduleSheet';
import { DayTimeline } from '@/components/DayTimeline';
import { Fab } from '@/components/Fab';
import { DayAgenda } from '@/components/DayAgenda';
import { SlotPickerSheet } from '@/components/SlotPickerSheet';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { WeekStrip } from '@/components/WeekStrip';
import { useStore } from '@/store';
import { radius, sp, useTheme } from '@/theme';

/**
 * 타임라인 탭 — 일 / 주 두 모드.
 *
 *   일  세로 타임라인. 빈 곳 롱프레스로 시간을 잡는다
 *   주  7일 스트립 + 고른 날의 리스트. 타임라인이 아니라 "어느 날이 찼나"에 답한다
 *
 * 월·분기는 아직 앱에 없다. 주가 실제로 쓰이는지 보고 정한다.
 */
export default function TimelineScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { blocks, tasks, routines, routineChecks, proposals, propose } = useStore();
  const [day, setDay] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [addOpen, setAddOpen] = useState(false);
  const [slotAt, setSlotAt] = useState<Date | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
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

  const range = useMemo(() => {
    if (mode === 'week') {
      const s0 = startOfWeek(day);
      return { start: s0, end: addDays(s0, 7) };
    }
    const s0 = startOfDay(day);
    return { start: s0, end: addDays(s0, 1) };
  }, [day, mode]);
  const prog = useMemo(() => rangeProgress(tasks, range.start, range.end), [tasks, range]);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : null;

  /**
   * 고정 일정은 Task가 아니다 — 점수·등급·위 진행률에 넣지 않는다 (3.8.4).
   * 지나간 것만 분모에 넣는다. 아직 오지 않은 수업을 "안 했다"고 셀 이유가 없다.
   */
  const fixed = useMemo(() => {
    const today = ymd(new Date());
    const occ = routineOccurrences(routines, range.start, range.end).filter((o) => o.day <= today);
    return { done: occ.filter((o) => routineChecks[checkKey(o.routine.id, o.day)]).length, total: occ.length };
  }, [routines, routineChecks, range]);

  // 주 모드에서는 한 주씩 넘긴다
  const shift = (n: number) => setDay(addDays(day, mode === 'week' ? n * 7 : n));

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
          <Text style={[styles.h1, { color: th.text }]} numberOfLines={1}>
            {mode === 'week'
              ? `${range.start.getMonth() + 1}/${range.start.getDate()} – ${addDays(range.start, 6).getMonth() + 1}/${addDays(range.start, 6).getDate()}`
              : day.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
          </Text>
          <Text style={{ color: th.textFaint, fontSize: 11, lineHeight: 15, marginTop: 2 }} numberOfLines={1}>
            {mode === 'week'
              ? `이번 주 마감 ${prog.total}개${pct !== null ? ` · ${pct}% 완료` : ''}`
              : `블록 ${dayBlocks.length}개 · ${Math.round((planned / 60) * 10) / 10}시간 잡힘${pct !== null ? ` · 마감 ${pct}%` : ''}`}
            {fixed.total > 0 ? `  ·  고정 ${fixed.done}/${fixed.total}` : ''}
          </Text>
        </View>

        {/* 3.8 — 이 앱에서 가장 특징적인 기능이라 눈에 띄는 자리에 둔다 */}
        <Pressable
          onPress={() => {
            if (!proposals.length) propose();
            setAutoOpen(true);
          }}
          style={[styles.autoBtn, { borderColor: th.accent, backgroundColor: proposals.length ? th.accent : th.accentSoft }]}
        >
          <Text style={{ fontSize: 12, fontWeight: '700', color: proposals.length ? '#fff' : th.accent }}>
            {proposals.length ? `제안 ${proposals.length}` : '⚡'}
          </Text>
        </Pressable>

        <View style={[styles.seg, { borderColor: th.border }]}>
          {(['day', 'week'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[styles.segBtn, mode === m && { backgroundColor: th.accentSoft }]}
            >
              <Text style={{ fontSize: 12, color: mode === m ? th.accent : th.textDim }}>
                {m === 'day' ? '일' : '주'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {mode === 'week' ? (
        <>
          <WeekStrip weekStart={range.start} selected={day} onSelect={setDay} />
          <DayAgenda day={day} onPickSlot={setSlotAt} />
        </>
      ) : (
        <>
          <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
            <View>
              <DayTimeline day={day} onPickSlot={setSlotAt} />
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
            빈 곳을 길게 누르면 그 시각에 할 일을 잡는다 · 블록은 길게 눌러 끌면 이동
          </Text>
        </>
      )}

      <Fab onPress={() => setAddOpen(true)} />
      <AddTaskSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <SlotPickerSheet at={slotAt} onClose={() => setSlotAt(null)} />
      <AutoScheduleSheet open={autoOpen} onClose={() => setAutoOpen(false)} />
      <TaskDetailSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  nav: { flexDirection: 'row', gap: 4 },
  navBtn: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  autoBtn: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  h1: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  nowLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, zIndex: 20 },
  nowBadge: { position: 'absolute', left: 4, top: -9, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.sm },
  nowText: { color: '#fff', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { position: 'absolute', left: 0, right: 90, textAlign: 'center', fontSize: 10 },
});

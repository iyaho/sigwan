import type { Block, Task } from '@sigwan/core';
import {
  checkKey,
  GRADE_COLOR,
  isOutOfRange,
  layoutBlocks,
  priorityScore,
  routineOccurrences,
  sleepSpans,
  ticks,
  timeToPx,
  ymd,
  ZOOMS,
} from '@sigwan/core';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useStore } from '../store';
import { radius, useTheme } from '../theme';

/**
 * 세로 하루 타임라인 — 웹 DayColumns의 모바일판.
 *
 * 웹에서는 pointermove에서 DOM style을 직접 만져 리렌더를 피했다.
 * RN에서는 같은 문제를 reanimated가 푼다 — 제스처와 스타일이 UI 스레드에서 돌아
 * JS 스레드가 바빠도 손가락을 따라온다. 그래서 웹처럼 "원래 style 복원" 같은
 * 꼼수가 필요 없고, 드래그 중에는 shared value만 움직인다.
 *
 * 저장은 손을 뗄 때 한 번. DB에는 스냅되지 않은 정확한 타임스탬프가 들어간다(3.2).
 */

const V = ZOOMS.day;
const PPM = V.pxPerMinute; // 1분당 px — 웹과 같은 72px/시간
const GUTTER = 48;
const AXIS_H = 1440 * PPM;
const SNAP_PX = V.snapMinutes * PPM;
const DRAG_THRESHOLD = 4;

export const TIMELINE_HEIGHT = AXIS_H;

/** 제안 블록은 id가 'p:'로 시작한다. 진짜 Block과 섞이지 않게 한 곳에서만 판별한다 */
const isProposal = (id: string) => id.startsWith('p:');

export function DayTimeline({ day, onPickSlot }: { day: Date; onPickSlot?: (at: Date) => void }) {
  const th = useTheme();
  const { blocks, tasks, routines, routineChecks, settings, proposals, toggleRoutineCheck } = useStore();
  const dayStart = useMemo(() => {
    const d = new Date(day);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [day]);
  const dayEnd = dayStart.getTime() + 864e5;

  /**
   * 제안(3.8.3)을 Block 모양으로 감싼다 — 레인 계산과 드래그가 그대로 따라온다.
   * 저장하는 지점에서만 갈라내므로 "제안인데 실수로 저장됐다"가 생기지 않는다.
   */
  const proposalBlocks = useMemo<Block[]>(
    () =>
      proposals.map((p) => ({
        id: `p:${p.key}`,
        user_id: 'local-user',
        task_id: p.taskId,
        title: p.title,
        start_at: p.start,
        end_at: p.end,
        is_all_day: false,
        source: 'drag',
        deleted_at: null,
        rev: 0,
      })),
    [proposals],
  );

  const visible = useMemo(
    () =>
      [...blocks, ...proposalBlocks].filter(
        (b) => !b.deleted_at && Date.parse(b.end_at) > dayStart.getTime() && Date.parse(b.start_at) < dayEnd,
      ),
    [blocks, proposalBlocks, dayStart, dayEnd],
  );

  /**
   * 막혀 있는 시간 — 수면과 고정 일정. **배경으로 깐다.**
   * layoutBlocks에 넣으면 8시간짜리 수면이 레인을 하나 먹어서 진짜 블록이 절반 폭이 된다.
   */
  const busy = useMemo(() => {
    const d1 = new Date(dayEnd);
    const within = (a: number, b: number) => b > dayStart.getTime() && a < dayEnd;
    return {
      sleeps: sleepSpans(settings.sleep, dayStart, d1)
        .filter((b) => within(Date.parse(b.start_at), Date.parse(b.end_at)))
        .map((b) => ({
          id: b.id,
          top: Math.max(0, timeToPx(new Date(b.start_at), dayStart, 'day')),
          bottom: Math.min(AXIS_H, timeToPx(new Date(b.end_at), dayStart, 'day')),
        }))
        .filter((x) => x.bottom > x.top),
      routines: routineOccurrences(routines, dayStart, d1)
        .filter((o) => within(o.start.getTime(), o.end.getTime()))
        .map((o) => ({
          o,
          top: Math.max(0, timeToPx(o.start, dayStart, 'day')),
          bottom: Math.min(AXIS_H, timeToPx(o.end, dayStart, 'day')),
        }))
        .filter((x) => x.bottom > x.top),
    };
  }, [routines, settings.sleep, dayStart, dayEnd]);

  const today = ymd(new Date());
  const { placed, laneCount } = useMemo(() => layoutBlocks(visible, dayStart, 'day'), [visible, dayStart]);
  const tickList = useMemo(() => ticks(dayStart, AXIS_H, 'day'), [dayStart]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  return (
    <View style={{ height: AXIS_H }}>
      {/* 빈 곳을 길게 누르면 그 시각에 할 일을 잡는다 (3.2의 모바일판).
          블록보다 먼저 그려서 블록 탭/드래그가 위에 온다 */}
      {onPickSlot && (
        <Pressable
          style={StyleSheet.absoluteFill}
          delayLongPress={300}
          onLongPress={(e) => {
            const min = Math.round(e.nativeEvent.locationY / PPM / V.snapMinutes) * V.snapMinutes;
            onPickSlot(new Date(dayStart.getTime() + min * 60_000));
          }}
        />
      )}

      <View pointerEvents="none" style={[styles.gutter, { backgroundColor: th.panel, borderRightColor: th.border }]} />

      {tickList.map((t) => (
        <View
          pointerEvents="none"
          key={t.t.getTime()}
          style={[
            styles.tick,
            { top: t.offset, borderTopColor: t.major ? th.border : th.border, opacity: t.major ? 1 : 0.45 },
          ]}
        >
          {t.major && <Text style={[styles.tickLabel, { color: th.textFaint }]}>{t.label}</Text>}
        </View>
      ))}

      {/* 수면 — 보여주기만 한다. 눌러서 할 일을 잡는 건 여기서도 된다 */}
      {busy.sleeps.map((sl) => (
        <View
          pointerEvents="none"
          key={sl.id}
          style={[styles.sleep, { top: sl.top, height: sl.bottom - sl.top, backgroundColor: th.sunken, borderColor: th.border }]}
        />
      ))}

      {/* 고정 일정 — 띠는 터치를 통과시키고 체크 단추만 받는다 (드래그를 막으면 안 된다) */}
      {busy.routines.map(({ o, top, bottom }) => {
        const done = !!routineChecks[checkKey(o.routine.id, o.day)];
        const future = o.day > today;
        return (
          <View
            pointerEvents="box-none"
            key={`${o.routine.id}:${o.day}`}
            style={[
              styles.routine,
              {
                top,
                height: bottom - top,
                borderLeftColor: o.routine.color,
                backgroundColor: th.panel,
                opacity: done ? 0.5 : 1,
              },
            ]}
          >
            <Pressable
              disabled={future}
              onPress={() => toggleRoutineCheck(o.routine.id, o.day)}
              hitSlop={8}
              style={[
                styles.check,
                {
                  borderColor: done ? o.routine.color : th.borderStrong,
                  backgroundColor: done ? o.routine.color : 'transparent',
                  opacity: future ? 0.35 : 1,
                },
              ]}
            >
              {done && <Text style={styles.checkMark}>✓</Text>}
            </Pressable>
            <Text
              numberOfLines={1}
              style={[
                styles.routineName,
                { color: o.routine.color, textDecorationLine: done ? 'line-through' : 'none' },
              ]}
            >
              {o.routine.name}
            </Text>
          </View>
        );
      })}

      {placed.map((p) => (
        <BlockView
          key={p.item.id}
          block={p.item}
          task={p.item.task_id ? taskById.get(p.item.task_id) : undefined}
          top={p.offset}
          height={Math.max(p.size, 22)}
          lane={p.lane}
          laneCount={laneCount}
        />
      ))}
    </View>
  );
}

function BlockView({
  block,
  task,
  top,
  height,
  lane,
  laneCount,
}: {
  block: Block;
  task: Task | undefined;
  top: number;
  height: number;
  lane: number;
  laneCount: number;
}) {
  const th = useTheme();
  const { saveBlock, select, editProposal } = useStore();
  const prop = isProposal(block.id);
  const pkey = prop ? block.id.slice(2) : '';
  const dy = useSharedValue(0);
  const dh = useSharedValue(0);
  const active = useSharedValue(0);

  /** 손을 뗄 때만 저장한다. 움직임이 없으면 클릭이므로 아무것도 안 한다 */
  const commitMove = (minutes: number) => {
    if (minutes === 0) return;
    const s = new Date(Date.parse(block.start_at) + minutes * 60_000);
    // 제안은 아직 DB에 없다. 여기서 저장하면 「적용」 버튼의 의미가 사라진다 (3.8.3)
    if (prop) return editProposal(pkey, { start: s });
    const dur = Date.parse(block.end_at) - Date.parse(block.start_at);
    void saveBlock({ ...block, start_at: s.toISOString(), end_at: new Date(s.getTime() + dur).toISOString() });
  };
  const commitResize = (minutes: number) => {
    if (minutes === 0) return;
    const end = Date.parse(block.end_at) + minutes * 60_000;
    const min = Date.parse(block.start_at) + V.snapMinutes * 60_000;
    const capped = new Date(Math.max(end, min));
    if (prop) return editProposal(pkey, { end: capped });
    void saveBlock({ ...block, end_at: capped.toISOString() });
  };

  const move = Gesture.Pan()
    .activateAfterLongPress(220) // 스크롤과 충돌하지 않게 — 롱프레스 후에야 잡는다
    .onStart(() => {
      active.value = 1;
    })
    .onUpdate((e) => {
      dy.value = Math.round(e.translationY / SNAP_PX) * SNAP_PX;
    })
    .onEnd(() => {
      runOnJS(commitMove)(dy.value / PPM);
      dy.value = 0;
      active.value = 0;
    })
    .onFinalize(() => {
      active.value = 0;
    });

  const resize = Gesture.Pan()
    .onStart(() => {
      active.value = 1;
    })
    .onUpdate((e) => {
      const next = Math.round(e.translationY / SNAP_PX) * SNAP_PX;
      dh.value = Math.max(SNAP_PX - height, next);
    })
    .onEnd(() => {
      runOnJS(commitResize)(dh.value / PPM);
      dh.value = 0;
      active.value = 0;
    })
    .onFinalize(() => {
      active.value = 0;
    });

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dy.value }],
    height: height + dh.value,
    opacity: active.value ? 0.85 : 1,
    zIndex: active.value ? 10 : 1,
  }));

  const isEvent = !task && !prop;
  const color = task ? GRADE_COLOR[priorityScore(task).grade] : 'transparent';
  const out = task ? isOutOfRange(block, task.due_at) : false;
  const laneW = 1 / Math.max(1, laneCount);

  return (
    <GestureDetector gesture={move}>
      <Animated.View
        style={[
          styles.block,
          {
            top,
            left: `${GUTTER_PCT + lane * laneW * (100 - GUTTER_PCT)}%`,
            width: `${laneW * (100 - GUTTER_PCT) - 1.5}%`,
            backgroundColor: prop ? th.accentSoft : isEvent ? th.panel : color,
            borderWidth: prop ? 1.5 : isEvent ? 1 : out ? 2 : 0,
            borderStyle: prop || isEvent ? 'dashed' : 'solid',
            borderColor: prop ? th.accent : out ? GRADE_COLOR.now : th.borderStrong,
          },
          aStyle,
        ]}
      >
        <Pressable style={{ flex: 1 }} onPress={() => block.task_id && select(block.task_id)}>
          <Text
            style={[styles.blockTitle, { color: prop ? th.accent : isEvent ? th.textDim : '#fff' }]}
            numberOfLines={height > 34 ? 2 : 1}
          >
            {task?.title ?? block.title}
          </Text>
          {height > 34 && (
            <Text
              style={[styles.blockTime, { color: prop ? th.accent : isEvent ? th.textFaint : 'rgba(255,255,255,0.85)' }]}
            >
              {prop ? `제안 · ${fmt(block.start_at)}` : fmt(block.start_at)}
            </Text>
          )}
        </Pressable>
        <GestureDetector gesture={resize}>
          <Animated.View style={styles.handle}>
            <View style={[styles.handleBar, { backgroundColor: isEvent ? th.borderStrong : 'rgba(255,255,255,0.6)' }]} />
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </GestureDetector>
  );
}

/** 거터를 %로 환산 — 블록 left/width를 퍼센트로 쓰기 위해. 폭은 화면마다 다르다 */
const GUTTER_PCT = 13;

function fmt(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  gutter: { position: 'absolute', left: 0, top: 0, bottom: 0, width: `${GUTTER_PCT}%`, borderRightWidth: StyleSheet.hairlineWidth },
  tick: { position: 'absolute', left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth },
  tickLabel: { position: 'absolute', left: 6, top: -8, fontSize: 11, fontVariant: ['tabular-nums'] },
  block: { position: 'absolute', borderRadius: radius.md, paddingHorizontal: 7, paddingTop: 4, overflow: 'hidden' },
  sleep: {
    position: 'absolute',
    left: `${GUTTER_PCT}%`,
    right: 0,
    opacity: 0.85,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  routine: {
    position: 'absolute',
    left: `${GUTTER_PCT}%`,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 6,
    paddingTop: 3,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    opacity: 0.95,
    overflow: 'hidden',
  },
  routineName: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  check: { width: 17, height: 17, borderRadius: radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontSize: 10, lineHeight: 12, fontWeight: '700' },
  blockTitle: { fontSize: 12, fontWeight: '600', lineHeight: 15 },
  blockTime: { fontSize: 10, marginTop: 1 },
  handle: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 16, alignItems: 'center', justifyContent: 'center' },
  handleBar: { width: 24, height: 3, borderRadius: 999 },
});

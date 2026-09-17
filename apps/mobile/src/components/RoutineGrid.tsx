import type { Routine, SleepPattern } from '@sigwan/core';
import { WEEKDAY_SHORT, hhmm } from '@sigwan/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, sp, useTheme } from '../theme';

/**
 * 3.8.1 고정 일정 시간표 — **보기 전용**이다.
 *
 * 웹은 격자를 끌어서 만들지만 폰에서는 작은 칸을 손가락으로 끌어 15분을 맞추는 게 답답하고,
 * 타임라인 탭의 롱프레스 드래그와 제스처가 겹친다. 그래서 입력은 시트(폼)로 받고
 * 이 격자는 **"어디에 들어가는가"를 보여주는 역할**만 한다.
 *
 * `preview`를 주면 아직 저장되지 않은 것을 점선으로 겹쳐 그린다 — 시트에서 시간을 고치는
 * 동안 격자가 같이 움직이는 게 이 화면의 요점이다.
 */

const GUTTER = 34;
const BASE_START = 8 * 60;
const BASE_END = 22 * 60;

export interface GridPreview {
  weekdays: number[];
  start: number;
  end: number;
  color: string;
  name: string;
}

const isWeekendWake = (wd: number) => wd === 5 || wd === 6;

/** 그 요일 칸에 깔릴 수면 띠. 아침은 이 날 규칙, 저녁은 내일 규칙(자정을 넘는 경우만) */
function sleepBands(wd: number, s: SleepPattern): [number, number][] {
  const startOf = (w: number) => (isWeekendWake(w) ? s.weekendStart : s.weekdayStart);
  const endOf = (w: number) => (isWeekendWake(w) ? s.weekendEnd : s.weekdayEnd);
  const out: [number, number][] = [];
  const my = { s: startOf(wd), e: endOf(wd) };
  out.push(my.s < my.e ? [my.s, my.e] : [0, my.e]);
  const tmr = (wd + 1) % 7;
  if (startOf(tmr) > endOf(tmr)) out.push([startOf(tmr), 1440]);
  return out.filter(([a, b]) => b > a);
}

export function RoutineGrid({
  routines,
  sleep,
  preview,
  onPressRoutine,
  pxPerMin = 0.42,
  forceWeekend,
}: {
  routines: Routine[];
  sleep: SleepPattern;
  preview?: GridPreview | null;
  onPressRoutine?: (r: Routine) => void;
  pxPerMin?: number;
  forceWeekend?: boolean;
}) {
  const th = useTheme();
  const [w, setW] = useState(0);

  const hasWeekend =
    routines.some((r) => r.weekdays.some((d) => d >= 5)) || (preview?.weekdays.some((d) => d >= 5) ?? false);
  const days = hasWeekend || forceWeekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];

  // 표시 범위는 내용에 맞춰 넓어진다. 새벽 3시가 늘 비어 있는 걸 스크롤할 이유가 없다
  let lo = BASE_START;
  let hi = BASE_END;
  for (const r of routines) {
    lo = Math.min(lo, r.start_min);
    hi = Math.max(hi, r.end_min);
  }
  if (preview) {
    lo = Math.min(lo, preview.start);
    hi = Math.max(hi, preview.end);
  }
  lo = Math.floor(lo / 60) * 60;
  hi = Math.ceil(hi / 60) * 60;

  const y = (min: number) => (Math.min(Math.max(min, lo), hi) - lo) * pxPerMin;
  const height = (hi - lo) * pxPerMin;
  const colW = w > GUTTER ? (w - GUTTER) / days.length : 0;

  const hours: number[] = [];
  for (let h = lo; h <= hi; h += 60) hours.push(h);

  return (
    <View>
      <View style={[styles.head, { paddingLeft: GUTTER }]}>
        {days.map((wd) => (
          <Text key={wd} style={[styles.dow, { color: th.textDim, width: colW }]}>
            {WEEKDAY_SHORT[wd]}
          </Text>
        ))}
      </View>

      <View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={[styles.body, { height, borderColor: th.border, backgroundColor: th.bg }]}
      >
        {hours.map((h) => (
          <View key={h} style={[styles.line, { top: y(h), borderTopColor: th.border }]}>
            <Text style={[styles.time, { color: th.textFaint, backgroundColor: th.bg }]}>{hhmm(h)}</Text>
          </View>
        ))}

        {colW > 0 &&
          days.map((wd, i) => {
            const left = GUTTER + i * colW;
            return (
              <View
                key={wd}
                style={[
                  styles.col,
                  { left, width: colW, borderLeftColor: th.border },
                  isWeekendWake(wd) && { backgroundColor: th.sunken },
                ]}
              >
                {/* 수면 — 자동 배치가 피하는 자리 */}
                {sleepBands(wd, sleep).map(([a, b]) => (
                  <View
                    key={a}
                    style={[
                      styles.sleep,
                      { top: y(a), height: Math.max(0, y(b) - y(a)), backgroundColor: th.sunken, borderColor: th.border },
                    ]}
                  />
                ))}

                {routines
                  .filter((r) => r.weekdays.includes(wd))
                  .map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => onPressRoutine?.(r)}
                      style={[
                        styles.block,
                        { top: y(r.start_min), height: Math.max(13, y(r.end_min) - y(r.start_min)), backgroundColor: r.color },
                      ]}
                    >
                      <Text numberOfLines={2} style={styles.blockText}>
                        {r.name}
                      </Text>
                    </Pressable>
                  ))}

                {/* 아직 저장되지 않은 것 — 시트에서 시간을 고치면 여기가 같이 움직인다 */}
                {preview?.weekdays.includes(wd) && (
                  <View
                    style={[
                      styles.preview,
                      {
                        top: y(preview.start),
                        height: Math.max(13, y(preview.end) - y(preview.start)),
                        borderColor: preview.color,
                        backgroundColor: th.accentSoft,
                      },
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.previewText, { color: preview.color }]}>
                      {preview.name || '여기'}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', paddingBottom: 3 },
  dow: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  body: { position: 'relative', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  line: { position: 'absolute', left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth },
  time: { position: 'absolute', left: 3, top: -6, fontSize: 9, paddingRight: 2 },
  col: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  sleep: { position: 'absolute', left: 0, right: 0, opacity: 0.9, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  block: { position: 'absolute', left: 1.5, right: 1.5, borderRadius: radius.sm, paddingHorizontal: 3, paddingVertical: 1, overflow: 'hidden' },
  blockText: { color: '#fff', fontSize: 9.5, fontWeight: '600', lineHeight: 12 },
  preview: { position: 'absolute', left: 1.5, right: 1.5, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', paddingHorizontal: 3, justifyContent: 'center' },
  previewText: { fontSize: 9.5, fontWeight: '700' },
  sp: { height: sp[1] },
});

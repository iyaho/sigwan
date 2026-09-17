import type { Routine } from '@sigwan/core';
import { hhmm } from '@sigwan/core';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RoutineGrid } from '@/components/RoutineGrid';
import { RoutineSheet } from '@/components/RoutineSheet';
import { Chip, Row } from '@/components/Sheet';
import { useStore } from '@/store';
import { radius, sp, useTheme } from '@/theme';

/**
 * 시간표 탭 (3.8) — 자동 배치가 피해야 할 것 둘을 여기서 받는다.
 *
 * 설정에 있던 것을 떼어왔다. 시간표는 "설정"이라기보다 들여다보는 화면이고,
 * 수면도 격자에 회색 띠로 이미 그려져 있어서 띠를 보며 바로 아래에서 고치는 게 자연스럽다.
 */

const GAP_CHIPS = [0, 5, 10, 15];
const STEP = 15;
const clampMin = (v: number) => Math.max(0, Math.min(1439, v));

export default function RoutineScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { routines, settings, saveSleep, setGapMin } = useStore();
  const [editing, setEditing] = useState<Routine | null>(null);
  const [sheet, setSheet] = useState(false);

  const sleep = settings.sleep;

  /** 취침 → 기상 길이. 자정을 넘으면 1440을 더한다 */
  const span = (from: number, to: number) => {
    const m = to >= from ? to - from : to + 1440 - from;
    return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
  };

  const Clock = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
    <View style={styles.clockRow}>
      <Text style={{ fontSize: 12, color: th.textFaint, width: 30 }}>{label}</Text>
      <Pressable onPress={() => onChange(clampMin(value - STEP))} hitSlop={8} style={[styles.pm, { borderColor: th.borderStrong }]}>
        <Text style={{ color: th.text, fontSize: 15 }}>−</Text>
      </Pressable>
      <Text style={[styles.clock, { color: th.text }]}>{hhmm(value)}</Text>
      <Pressable onPress={() => onChange(clampMin(value + STEP))} hitSlop={8} style={[styles.pm, { borderColor: th.borderStrong }]}>
        <Text style={{ color: th.text, fontSize: 15 }}>＋</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + sp[5] * 2 }}>
        <View style={[styles.head, { borderBottomColor: th.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.h1, { color: th.text }]}>시간표</Text>
            <Text style={{ color: th.textFaint, fontSize: 12, marginTop: 2 }}>
              고정 일정 {routines.length}개 · 자동 배치가 이 시간을 피한다
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setEditing(null);
              setSheet(true);
            }}
            style={[styles.addBtn, { borderColor: th.accent, backgroundColor: th.accentSoft }]}
          >
            <Text style={{ color: th.accent, fontSize: 13, fontWeight: '700' }}>＋ 추가</Text>
          </Pressable>
        </View>

        <View style={{ padding: sp[4] }}>
          <RoutineGrid
            routines={routines}
            sleep={sleep}
            pxPerMin={0.55}
            onPressRoutine={(r) => {
              setEditing(r);
              setSheet(true);
            }}
          />
          <Text style={[styles.hint, { color: th.textFaint }]}>
            {routines.length
              ? '블록을 누르면 고친다. 회색 빗금은 수면이다.'
              : '아직 없다. ＋ 추가로 넣으면 이 격자에 그려진다. 회색 빗금은 수면이다.'}
          </Text>
        </View>

        {/* ── 수면 ─────────────────────────────────────────── */}
        <Text style={[styles.section, { color: th.textFaint }]}>수면</Text>
        <Text style={[styles.hint2, { color: th.textFaint }]}>
          평일·주말 판정은 <Text style={{ fontWeight: '700' }}>일어나는 날</Text> 기준이다 — 금요일 밤은 주말 규칙이다.
        </Text>
        <View style={styles.cards}>
          <View style={[styles.card, { borderColor: th.border, backgroundColor: th.sunken }]}>
            <Text style={[styles.cardTitle, { color: th.text }]}>평일</Text>
            <Clock label="취침" value={sleep.weekdayStart} onChange={(v) => saveSleep({ ...sleep, weekdayStart: v })} />
            <Clock label="기상" value={sleep.weekdayEnd} onChange={(v) => saveSleep({ ...sleep, weekdayEnd: v })} />
            <Text style={{ color: th.textFaint, fontSize: 11, marginTop: 4 }}>{span(sleep.weekdayStart, sleep.weekdayEnd)}</Text>
          </View>
          <View style={[styles.card, { borderColor: th.border, backgroundColor: th.sunken }]}>
            <Text style={[styles.cardTitle, { color: th.text }]}>주말</Text>
            <Clock label="취침" value={sleep.weekendStart} onChange={(v) => saveSleep({ ...sleep, weekendStart: v })} />
            <Clock label="기상" value={sleep.weekendEnd} onChange={(v) => saveSleep({ ...sleep, weekendEnd: v })} />
            <Text style={{ color: th.textFaint, fontSize: 11, marginTop: 4 }}>{span(sleep.weekendStart, sleep.weekendEnd)}</Text>
          </View>
        </View>

        {/* ── 간격 ─────────────────────────────────────────── */}
        <Text style={[styles.section, { color: th.textFaint }]}>자동 배치 간격</Text>
        <View style={{ paddingHorizontal: sp[4] }}>
          <Row>
            {GAP_CHIPS.map((v) => (
              <Chip key={v} label={v === 0 ? '없음' : `${v}분`} small on={settings.gap_min === v} onPress={() => setGapMin(v)} />
            ))}
          </Row>
          <Text style={[styles.hint, { color: th.textFaint, paddingHorizontal: 0 }]}>
            수업이 끝나자마자 다음 일을 시작할 수는 없다. 맞닿는 자리마다 이만큼 띄운다.
          </Text>
        </View>
      </ScrollView>

      <RoutineSheet open={sheet} routine={editing} onClose={() => setSheet(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  addBtn: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8 },
  section: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: sp[4], paddingTop: sp[4], paddingBottom: sp[1] },
  hint: { fontSize: 11.5, lineHeight: 16, paddingTop: sp[2] },
  hint2: { fontSize: 11.5, lineHeight: 16, paddingHorizontal: sp[4], paddingBottom: sp[2] },
  cards: { flexDirection: 'row', gap: sp[2], paddingHorizontal: sp[4] },
  card: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: sp[3] },
  cardTitle: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  pm: { borderWidth: 1, borderRadius: radius.sm, width: 28, height: 26, alignItems: 'center', justifyContent: 'center' },
  clock: { fontSize: 14, fontWeight: '600', width: 48, textAlign: 'center', fontVariant: ['tabular-nums'] },
});

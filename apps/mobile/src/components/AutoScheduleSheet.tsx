import { WEEKDAY_SHORT, ymd } from '@sigwan/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';
import { Chip, Row, Sheet } from './Sheet';

/**
 * 3.8.3 자동 배치 검토 — 제안을 보고, 고치고, 적용한다.
 *
 * 이 시트의 무게중심은 위쪽 제안 목록이 아니라 아래쪽 **「안 들어간 것」**이다.
 * 자동 배치의 쓸모는 시간을 채워주는 데 있지 않고 "이번 주엔 다 못 한다"를
 * 월요일에 알려주는 데 있다. 금요일에 알면 늦다.
 *
 * 시트를 닫아도 제안은 남는다 — 타임라인에서 점선 막대를 끌어 옮긴 뒤 다시 열면 된다.
 */

const hm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = ymd(new Date()) === ymd(d);
  return `${today ? '오늘' : `${d.getMonth() + 1}/${d.getDate()}`} (${WEEKDAY_SHORT[(d.getDay() + 6) % 7]})`;
};

const hours = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10}시간` : `${min}분`);

export function AutoScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const th = useTheme();
  const { proposals, autoResult, autoRange, autoEdited, propose, dropProposal, clearProposals, applyProposals, select } =
    useStore();

  const total = proposals.reduce((m, p) => m + p.minutes, 0);
  const unplaced = autoResult?.unplaced ?? [];

  // 날짜별로 묶어야 "수요일에만 몰렸네"가 보인다
  const byDay: [string, typeof proposals][] = [];
  for (const p of [...proposals].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const k = ymd(new Date(p.start));
    const last = byDay[byDay.length - 1];
    if (last && last[0] === k) last[1].push(p);
    else byDay.push([k, [p]]);
  }

  return (
    <Sheet open={open} onClose={onClose} title="자동 배치">
      <View style={styles.headRow}>
        <Row>
          <Chip label="오늘" small on={autoRange === 'today'} onPress={() => propose('today')} />
          <Chip label="7일" small on={autoRange === 'week'} onPress={() => propose('week')} />
        </Row>
        <Text style={{ color: th.textFaint, fontSize: 12 }}>
          {proposals.length}개 · {hours(total)}
        </Text>
      </View>
      {autoEdited && (
        <Text style={{ color: th.textFaint, fontSize: 11 }}>범위를 바꾸면 옮겨둔 제안은 다시 계산된다</Text>
      )}

      {byDay.map(([day, ps]) => (
        <View key={day} style={{ gap: 2 }}>
          <Text style={{ color: th.textFaint, fontSize: 11, fontWeight: '700' }}>{dayLabel(ps[0]?.start as string)}</Text>
          {ps.map((p) => (
            <View key={p.key} style={styles.row}>
              <Text style={[styles.time, { color: th.textDim }]}>
                {hm(p.start)}–{hm(p.end)}
              </Text>
              <Pressable style={{ flex: 1 }} onPress={() => select(p.taskId)}>
                <Text numberOfLines={1} style={{ color: th.text, fontSize: 14 }}>
                  {p.title}
                </Text>
              </Pressable>
              <Text style={{ color: th.textFaint, fontSize: 11 }}>{hours(p.minutes)}</Text>
              <Pressable onPress={() => dropProposal(p.key)} hitSlop={10}>
                <Text style={{ color: th.textFaint, fontSize: 15 }}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}

      {!proposals.length && (
        <Text style={{ color: th.textFaint, fontSize: 12 }}>
          {autoRange === 'today' ? '오늘 남은 시간에는 넣을 자리가 없다.' : '넣을 제안이 없다.'}
        </Text>
      )}

      {/* 여기가 이 시트의 요점이다 */}
      {unplaced.length > 0 && (
        <View style={[styles.unplaced, { borderColor: '#e5484d' }]}>
          <Text style={{ color: '#e5484d', fontSize: 13, fontWeight: '700' }}>
            {autoRange === 'today' ? '오늘' : '이번 주'} 안 들어가는 것 {unplaced.length}개
          </Text>
          {unplaced.map((u) => (
            <View key={u.taskId} style={{ gap: 1, marginTop: 6 }}>
              <Pressable onPress={() => select(u.taskId)}>
                <Text numberOfLines={1} style={{ color: th.text, fontSize: 14 }}>
                  {u.title}
                </Text>
              </Pressable>
              <Text style={{ color: th.textDim, fontSize: 11 }}>
                {hours(u.shortfallMin)} 모자람 — {u.reason}
              </Text>
            </View>
          ))}
          <Text style={{ color: th.textFaint, fontSize: 11, marginTop: 8, lineHeight: 15 }}>
            마감을 미루거나, 예상 시간을 줄이거나, 다른 일을 빼야 한다. 늘릴 수 있는 건 시간이 아니다.
          </Text>
        </View>
      )}

      <Text style={{ color: th.textFaint, fontSize: 11 }}>
        시트를 닫고 타임라인의 점선 막대를 길게 눌러 끌면 자리를 옮길 수 있다.
      </Text>

      <View style={{ flexDirection: 'row', gap: sp[2] }}>
        <Pressable
          onPress={() => {
            clearProposals();
            onClose();
          }}
          style={[styles.ghost, { borderColor: th.border }]}
        >
          <Text style={{ color: th.textDim }}>취소</Text>
        </Pressable>
        <Pressable
          disabled={!proposals.length}
          onPress={() => applyProposals().then(onClose)}
          style={[styles.primary, { backgroundColor: proposals.length ? th.accent : th.borderStrong }]}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>적용 ({proposals.length})</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp[2], paddingVertical: 3 },
  time: { fontSize: 11, fontVariant: ['tabular-nums'], width: 82 },
  unplaced: { borderWidth: 1, borderRadius: radius.md, padding: sp[3] },
  ghost: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 12 },
  primary: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md },
});

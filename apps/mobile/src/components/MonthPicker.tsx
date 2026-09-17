import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, sp, useTheme } from '../theme';

/**
 * 날짜 선택 — 직접 그린 달력. 의존성 없음.
 *
 * 네이티브 피커(`@react-native-community/datetimepicker`)는 네이티브 모듈이라 넣는 순간
 * 재빌드가 필요하다. 이 화면이 요구하는 건 "연·월을 넘기며 하루를 고른다" 하나뿐이라
 * 의존성을 늘릴 이유가 없다. 바깥에서 보면 `value`/`onPick`이 전부이므로,
 * 나중에 위젯(M4)으로 어차피 재빌드할 때 네이티브 피커로 바꾸려면 이 파일만 갈아끼우면 된다.
 *
 * 세 단계로 파고든다: 연 → 월 → 일. 머리의 「2027년」이나 「3월」을 누르면 그 단계로 올라간다.
 * ◀▶만 두면 내년 3월 마감을 잡는 데 열다섯 번을 눌러야 한다.
 *
 * 지난 날짜도 고를 수 있다. 마감이 이미 지난 일을 뒤늦게 넣는 건 정상이고,
 * 점수 공식이 그걸 +30으로 올려준다 (4장).
 */

const WD = ['월', '화', '수', '목', '금', '토', '일'];
const YEARS_PER_PAGE = 12;

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 'YYYY-MM-DD' → Date. T00:00:00을 붙여야 로컬 자정으로 읽힌다 (없으면 UTC로 읽혀 전날이 된다) */
const parse = (s: string) => new Date(`${s}T00:00:00`);

type Level = 'day' | 'month' | 'year';

export function MonthPicker({ value, onPick }: { value: string | null; onPick: (day: string) => void }) {
  const th = useTheme();
  const base = value ? parse(value) : new Date();
  const [cursor, setCursor] = useState(new Date(base.getFullYear(), base.getMonth(), 1));
  const [level, setLevel] = useState<Level>('day');

  const today = new Date();
  const todayKey = ymd(today);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const shift = (n: number) => {
    if (level === 'day') setCursor(new Date(year, month + n, 1));
    else if (level === 'month') setCursor(new Date(year + n, month, 1));
    else setCursor(new Date(year + n * YEARS_PER_PAGE, month, 1));
  };

  // 연 목록은 커서가 든 12년 구간. 2026이면 2020~2031
  const yearStart = Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;

  return (
    <View style={[styles.wrap, { borderColor: th.border, backgroundColor: th.bg }]}>
      <View style={styles.head}>
        <Pressable onPress={() => shift(-1)} hitSlop={10} style={[styles.nav, { borderColor: th.borderStrong }]}>
          <Text style={{ color: th.text }}>◀</Text>
        </Pressable>

        <View style={styles.titleRow}>
          <Pressable onPress={() => setLevel(level === 'year' ? 'day' : 'year')} hitSlop={6}>
            <Text style={[styles.title, { color: level === 'year' ? th.accent : th.text }]}>
              {level === 'year' ? `${yearStart}–${yearStart + YEARS_PER_PAGE - 1}` : `${year}년`}
            </Text>
          </Pressable>
          {level !== 'year' && (
            <Pressable onPress={() => setLevel(level === 'month' ? 'day' : 'month')} hitSlop={6}>
              <Text style={[styles.title, { color: level === 'month' ? th.accent : th.text }]}>{month + 1}월</Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => {
            setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
            setLevel('day');
          }}
          hitSlop={6}
          style={[styles.nav, { borderColor: th.borderStrong }]}
        >
          <Text style={{ color: th.textDim, fontSize: 12 }}>오늘</Text>
        </Pressable>

        <Pressable onPress={() => shift(1)} hitSlop={10} style={[styles.nav, { borderColor: th.borderStrong }]}>
          <Text style={{ color: th.text }}>▶</Text>
        </Pressable>
      </View>

      {level === 'year' && (
        <View style={styles.grid}>
          {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearStart + i).map((y) => {
            const on = y === year;
            return (
              <Pressable
                key={y}
                onPress={() => {
                  setCursor(new Date(y, month, 1));
                  setLevel('month');
                }}
                style={styles.wideCell}
              >
                <View style={[styles.pill, on && { backgroundColor: th.accent }]}>
                  <Text style={{ fontSize: 14, color: on ? '#fff' : th.text, fontWeight: on ? '700' : '400' }}>{y}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {level === 'month' && (
        <View style={styles.grid}>
          {Array.from({ length: 12 }, (_, i) => i).map((m) => {
            const on = m === month;
            const isThis = y0(today) === year && today.getMonth() === m;
            return (
              <Pressable
                key={m}
                onPress={() => {
                  setCursor(new Date(year, m, 1));
                  setLevel('day');
                }}
                style={styles.wideCell}
              >
                <View
                  style={[
                    styles.pill,
                    on && { backgroundColor: th.accent },
                    !on && isThis && { borderWidth: 1.5, borderColor: th.accent },
                  ]}
                >
                  <Text style={{ fontSize: 14, color: on ? '#fff' : th.text, fontWeight: on ? '700' : '400' }}>
                    {m + 1}월
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {level === 'day' && (
        <>
          <View style={styles.row}>
            {WD.map((w, i) => (
              <Text key={w} style={[styles.wd, { color: i >= 5 ? th.textDim : th.textFaint }]}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {/* 앞 빈칸 + 날짜. 1일이 몇 번째 칸인가 — 0=월 기준으로 옮긴다 (getDay는 0=일) */}
            {[
              ...Array((new Date(year, month, 1).getDay() + 6) % 7).fill(null),
              ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1),
            ].map((d: number | null, i) => {
              if (d === null) return <View key={`e${i}`} style={styles.cell} />;
              const key = ymd(new Date(year, month, d));
              const on = key === value;
              const isToday = key === todayKey;
              const weekend = i % 7 >= 5;
              return (
                <Pressable key={key} onPress={() => onPick(key)} style={styles.cell}>
                  <View
                    style={[
                      styles.day,
                      on && { backgroundColor: th.accent },
                      !on && isToday && { borderWidth: 1.5, borderColor: th.accent },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        color: on ? '#fff' : weekend ? th.textDim : th.text,
                        fontWeight: on || isToday ? '700' : '400',
                      }}
                    >
                      {d}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={{ color: th.textFaint, fontSize: 11, textAlign: 'center', paddingBottom: 6 }}>
        {level === 'day'
          ? '「2026년」이나 「10월」을 누르면 연·월을 한 번에 고른다'
          : level === 'month'
            ? '달을 고르면 날짜로 돌아간다'
            : '연도를 고르면 달로 넘어간다'}
      </Text>
    </View>
  );
}

const y0 = (d: Date) => d.getFullYear();

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 6, paddingTop: 6, marginTop: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingBottom: 6 },
  titleRow: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  nav: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 4 },
  title: { fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row' },
  wd: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 11, paddingVertical: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1.15, alignItems: 'center', justifyContent: 'center' },
  wideCell: { width: `${100 / 3}%`, paddingVertical: 5, alignItems: 'center' },
  day: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
});

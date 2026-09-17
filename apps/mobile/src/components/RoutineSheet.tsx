import type { Routine } from '@sigwan/core';
import { WEEKDAY_SHORT, hhmm, ymd } from '@sigwan/core';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';
import { type GridPreview, RoutineGrid } from './RoutineGrid';
import { Chip, Field, Row, Sheet } from './Sheet';

/**
 * 3.8.1 고정 일정 추가·수정 — 폼으로 받되 **격자에 어디 들어가는지 같이 보여준다.**
 *
 * 시각은 텍스트로 치게 하지 않고 15분 단위 스테퍼로 받는다. `HH:MM`을 치게 하면
 * 키보드가 올라와 격자를 가리고, 오타 검증이 또 필요해진다.
 */

export const ROUTINE_COLORS = ['#3e63dd', '#8e4ec6', '#d6409f', '#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#0d9488'];

const STEP = 15;
const clampMin = (v: number) => Math.max(0, Math.min(1440, v));

export function RoutineSheet({
  open,
  routine,
  onClose,
}: {
  open: boolean;
  /** null이면 새로 만드는 중 */
  routine: Routine | null;
  onClose: () => void;
}) {
  const th = useTheme();
  const { routines, settings, addRoutine, saveRoutine, removeRoutine } = useStore();

  const [name, setName] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [start, setStart] = useState(9 * 60);
  const [end, setEnd] = useState(10 * 60 + 30);
  const [color, setColor] = useState(ROUTINE_COLORS[0] as string);
  const [err, setErr] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  // 열릴 때마다 초기화. 안 하면 지난번에 고치던 값이 남는다
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setArmed(false);
    if (routine) {
      setName(routine.name);
      setWeekdays(routine.weekdays);
      setStart(routine.start_min);
      setEnd(routine.end_min);
      setColor(routine.color);
    } else {
      setName('');
      setWeekdays([]);
      setStart(9 * 60);
      setEnd(10 * 60 + 30);
      setColor(ROUTINE_COLORS[routines.length % ROUTINE_COLORS.length] as string);
    }
  }, [open, routine, routines.length]);

  const preview: GridPreview | null = weekdays.length ? { weekdays, start, end, color, name } : null;

  /** 겹치는 고정 일정이 있으면 그 이름을 돌려준다 (3.8.1) */
  function conflict(): string | null {
    for (const r of routines) {
      if (r.id === routine?.id || r.deleted_at) continue;
      if (start >= r.end_min || end <= r.start_min) continue;
      const hit = r.weekdays.find((w) => weekdays.includes(w));
      if (hit !== undefined) return `${WEEKDAY_SHORT[hit]} ${r.name}과 겹친다`;
    }
    return null;
  }

  async function submit() {
    if (!name.trim()) return setErr('이름을 넣는다');
    if (!weekdays.length) return setErr('요일을 하나 이상 고른다');
    // 자정을 넘는 일정은 펼칠 때 길이가 음수가 된다 (3.8.1)
    if (end <= start) return setErr('끝나는 시각이 시작보다 빠르다. 자정을 넘는 일정은 둘로 나눠 넣는다');
    const c = conflict();
    if (c) return setErr(c);

    const body = {
      name: name.trim(),
      weekdays: [...weekdays].sort((a, b) => a - b),
      start_min: start,
      end_min: end,
      color,
      // 오늘부터 무기한이 기본. 비워두면 지난 주 화면까지 바뀐다
      active_from: routine?.active_from ?? ymd(new Date()),
      active_to: routine?.active_to ?? null,
    };
    if (routine) await saveRoutine({ ...routine, ...body });
    else await addRoutine(body);
    onClose();
  }

  const Stepper = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
    <View style={styles.stepper}>
      <Text style={{ fontSize: 11, color: th.textFaint, width: 28 }}>{label}</Text>
      <Pressable onPress={() => onChange(clampMin(value - STEP))} hitSlop={8} style={[styles.pm, { borderColor: th.borderStrong }]}>
        <Text style={{ color: th.text, fontSize: 16 }}>−</Text>
      </Pressable>
      <Text style={[styles.clock, { color: th.text }]}>{hhmm(value)}</Text>
      <Pressable onPress={() => onChange(clampMin(value + STEP))} hitSlop={8} style={[styles.pm, { borderColor: th.borderStrong }]}>
        <Text style={{ color: th.text, fontSize: 16 }}>＋</Text>
      </Pressable>
    </View>
  );

  return (
    <Sheet open={open} onClose={onClose} title={routine ? '고정 일정 수정' : '고정 일정 추가'}>
      {/* 격자가 위에 있는 게 요점이다 — 시간을 고치면 여기가 같이 움직인다 */}
      <RoutineGrid
        routines={routines.filter((r) => r.id !== routine?.id)}
        sleep={settings.sleep}
        preview={preview}
        pxPerMin={0.3}
        forceWeekend={weekdays.some((w) => w >= 5)}
      />

      <Field label="이름">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="자료구조 / 알바"
          placeholderTextColor={th.textFaint}
          maxLength={100}
          style={[styles.input, { borderColor: th.borderStrong, color: th.text, backgroundColor: th.bg }]}
        />
      </Field>

      <Field label="요일" hint="여러 요일을 고르면 한 과목으로 묶인다">
        <Row>
          {WEEKDAY_SHORT.map((w, i) => (
            <Chip
              key={w}
              label={w}
              small
              on={weekdays.includes(i)}
              onPress={() => setWeekdays((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i]))}
            />
          ))}
        </Row>
      </Field>

      <Field label="시각">
        <Stepper label="시작" value={start} onChange={setStart} />
        <Stepper label="끝" value={end} onChange={setEnd} />
      </Field>

      <Field label="색">
        <Row>
          {ROUTINE_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={[styles.swatch, { backgroundColor: c }, color === c && { borderColor: th.text, borderWidth: 2.5 }]}
            />
          ))}
        </Row>
      </Field>

      {err && <Text style={{ color: '#e5484d', fontSize: 12 }}>{err}</Text>}

      <View style={{ flexDirection: 'row', gap: sp[2], alignItems: 'center' }}>
        <Pressable onPress={submit} style={[styles.primary, { backgroundColor: th.accent }]}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>{routine ? '저장' : '추가'}</Text>
        </Pressable>
        {routine && (
          // 두 번 눌러야 지워진다. Alert는 화면을 통째로 막아서 쓰지 않는다
          <Pressable
            onPress={() => (armed ? removeRoutine(routine.id).then(onClose) : setArmed(true))}
            style={[styles.danger, { borderColor: '#e5484d' }]}
          >
            <Text style={{ color: '#e5484d', fontSize: 12 }}>{armed ? '정말 지울까?' : '삭제'}</Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: sp[2], marginTop: 4 },
  pm: { borderWidth: 1, borderRadius: radius.md, width: 34, height: 30, alignItems: 'center', justifyContent: 'center' },
  clock: { fontSize: 16, fontWeight: '600', width: 62, textAlign: 'center', fontVariant: ['tabular-nums'] },
  swatch: { width: 26, height: 26, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  primary: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md },
  danger: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12 },
});

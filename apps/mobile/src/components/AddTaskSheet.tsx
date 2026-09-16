import type { Task } from '@sigwan/core';
import { GRADE_COLOR, GRADE_LABEL, dueFields, priorityScore, sortByPriority } from '@sigwan/core';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DATE_CHIPS, EST_CHIPS, TIME_CHIPS, fmtEst, fmtYmd, shiftYmd } from '../dateChips';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';
import { Chip, Field, Row, Sheet } from './Sheet';

/**
 * 3.3 직접 추가 — 앱의 기본은 칸을 나눈 폼이다.
 *
 * 명세가 못 박은 다섯:
 *  1. 필수는 제목 하나 (est 60분, importance 3이 기본값)
 *  2. 날짜·소요시간은 칩으로 탭 한 번
 *  3. kind는 사용자가 고르지 않는다 — dueFields()가 결정
 *  4. 저장 전에 등급·순위를 보여준다
 *  5. 중요도는 접지 않는다
 */
export function AddTaskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const th = useTheme();
  const { addTask, tags, tasks, select } = useStore();

  const [title, setTitle] = useState('');
  const [preset, setPreset] = useState('없음');
  const [dateStr, setDateStr] = useState<string | null>(null);
  const [timeStr, setTimeStr] = useState('');
  const [estMin, setEstMin] = useState(60);
  const [importance, setImportance] = useState(3);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [notes, setNotes] = useState('');
  const [scheduleNow, setScheduleNow] = useState(false);
  const [busy, setBusy] = useState(false);

  const draft = useMemo(
    () => ({
      title: title || '(제목 없음)',
      estimate_min: estMin,
      importance,
      ...dueFields(dateStr, timeStr),
    }),
    [title, dateStr, timeStr, estMin, importance],
  );

  // 3.3-4 저장 전 미리보기. 중요도를 바꾸면 여기가 즉시 바뀐다
  const preview = useMemo(() => {
    const now = new Date();
    const fake = { ...BLANK, ...draft, id: '__draft__' } as Task;
    const s = priorityScore(fake, now);
    if (!Number.isFinite(s.score)) return { s, rank: null as number | null, total: 0 };
    const live = tasks.filter((t) => !t.deleted_at && t.status !== 'done' && t.kind !== 'someday');
    const sorted = sortByPriority([...live, fake], now);
    return { s, rank: sorted.findIndex((t) => t.id === '__draft__') + 1, total: sorted.length };
  }, [draft, tasks]);

  function reset() {
    setTitle('');
    setPreset('없음');
    setDateStr(null);
    setTimeStr('');
    setEstMin(60);
    setImportance(3);
    setTagIds([]);
    setMore(false);
    setNotes('');
    setScheduleNow(false);
  }

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const id = await addTask({ ...draft, title, notes: notes.trim() || null }, { tagIds, scheduleNow });
      select(id);
      reset();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="할 일 추가">
      <Field label="제목">
        {/* biome-ignore lint/a11y/noAutofocus: 시트가 열리는 이유가 이 칸이다 */}
        <TextInput
          autoFocus
          value={title}
          onChangeText={setTitle}
          placeholder="무엇을 해야 하나"
          placeholderTextColor={th.textFaint}
          maxLength={200}
          style={[styles.input, { borderColor: th.borderStrong, color: th.text, backgroundColor: th.bg }]}
        />
      </Field>

      <Field
        label="언제까지"
        hint={dateStr ? '시각을 비우면 그날 하루 할 일, 넣으면 기한 투두' : undefined}
      >
        <Row>
          {DATE_CHIPS.map((c) => (
            <Chip
              key={c.label}
              label={c.label}
              on={preset === c.label}
              onPress={() => {
                setPreset(c.label);
                const v = c.get();
                setDateStr(v);
                if (!v) setTimeStr('');
              }}
            />
          ))}
        </Row>
        {dateStr && (
          <View style={{ gap: 6, marginTop: 4 }}>
            <Row>
              <Stepper th={th} onPress={() => setDateStr(shiftYmd(dateStr, -1))} label="◀" />
              <Text style={{ color: th.text, fontSize: 13, minWidth: 110, textAlign: 'center' }}>
                {fmtYmd(dateStr)}
              </Text>
              <Stepper th={th} onPress={() => setDateStr(shiftYmd(dateStr, 1))} label="▶" />
            </Row>
            <Row>
              {TIME_CHIPS.map((t) => (
                <Chip key={t || 'none'} small label={t || '종일'} on={timeStr === t} onPress={() => setTimeStr(t)} />
              ))}
            </Row>
          </View>
        )}
      </Field>

      <Field label="얼마나 걸릴까">
        <Row>
          {EST_CHIPS.map(([label, v]) => (
            <Chip key={v} label={label} on={estMin === v} onPress={() => setEstMin(v)} />
          ))}
          <Stepper th={th} label="−15" onPress={() => setEstMin((m) => Math.max(5, m - 15))} />
          <Stepper th={th} label="+15" onPress={() => setEstMin((m) => m + 15)} />
        </Row>
        {!EST_CHIPS.some(([, v]) => v === estMin) && (
          <Text style={{ color: th.textDim, fontSize: 12 }}>{fmtEst(estMin)}</Text>
        )}
      </Field>

      {/* 3.3-5 중요도는 접지 않는다 */}
      <Field label="중요도">
        <Row>
          {[1, 2, 3, 4, 5].map((v) => (
            <Chip key={v} label={String(v)} on={importance === v} onPress={() => setImportance(v)} />
          ))}
        </Row>
      </Field>

      <Pressable onPress={() => setMore((v) => !v)} hitSlop={8}>
        <Text style={{ color: th.textDim, fontSize: 13 }}>{more ? '▾' : '▸'} 세부 설정</Text>
      </Pressable>

      {more && (
        <View style={{ gap: sp[4] }}>
          <Field label="태그">
            <Row>
              {tags.map((t) => (
                <Chip
                  key={t.id}
                  small
                  dot={t.color}
                  label={t.name}
                  on={tagIds.includes(t.id)}
                  onPress={() =>
                    setTagIds((ids) => (ids.includes(t.id) ? ids.filter((x) => x !== t.id) : [...ids, t.id]))
                  }
                />
              ))}
            </Row>
          </Field>
          <Pressable onPress={() => setScheduleNow((v) => !v)} style={styles.checkRow}>
            <View style={[styles.box, { borderColor: th.borderStrong, backgroundColor: scheduleNow ? th.accent : 'transparent' }]}>
              {scheduleNow && <Text style={{ color: '#fff', fontSize: 12, lineHeight: 14 }}>✓</Text>}
            </View>
            <Text style={{ color: th.textDim, fontSize: 13, flex: 1 }}>
              지금 블록 잡기 — 현재 시각부터 {fmtEst(estMin)}
            </Text>
          </Pressable>
          <Field label="메모">
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              style={[styles.input, styles.area, { borderColor: th.borderStrong, color: th.text, backgroundColor: th.bg }]}
            />
          </Field>
        </View>
      )}

      {/* 3.3-4 미리보기 */}
      <View style={[styles.preview, { backgroundColor: th.sunken }]}>
        <View style={[styles.pill, { backgroundColor: GRADE_COLOR[preview.s.grade] }]}>
          <Text style={styles.pillText}>
            {draft.kind === 'someday' ? '인박스' : GRADE_LABEL[preview.s.grade]}
          </Text>
        </View>
        <Text style={{ color: th.textDim, fontSize: 12, flex: 1, lineHeight: 17 }}>{sentence(draft, preview)}</Text>
      </View>

      <Pressable
        onPress={submit}
        disabled={!title.trim() || busy}
        style={[styles.submit, { backgroundColor: th.accent, opacity: !title.trim() || busy ? 0.45 : 1 }]}
      >
        <Text style={styles.submitText}>추가</Text>
      </Pressable>
    </Sheet>
  );
}

function Stepper({ th, label, onPress }: { th: ReturnType<typeof useTheme>; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.step, { borderColor: th.borderStrong }]}>
      <Text style={{ color: th.textDim, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function sentence(
  draft: Partial<Task> & { title: string },
  p: { s: ReturnType<typeof priorityScore>; rank: number | null; total: number },
) {
  if (draft.kind === 'someday') return '인박스로 들어간다 — 날짜를 정하기 전까지 급한 순 정렬에서 빠진다';
  const when =
    draft.kind === 'day'
      ? `${fmtYmd(draft.day_of as string)} 하루 할 일`
      : `${new Date(draft.due_at as string).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 마감`;
  const rank = p.rank ? ` · 급한 순 ${p.rank}/${p.total}번째` : '';
  return `${when} · ${fmtEst(draft.estimate_min ?? 60)} · 점수 ${p.s.score.toFixed(1)}${rank}`;
}

const BLANK = {
  user_id: 'local-user',
  notes: null,
  status: 'todo',
  day_of: null,
  start_at: null,
  due_at: null,
  spent_min: 0,
  progress: 0,
  pinned: false,
  parent_id: null,
  rrule: null,
  sort_order: 0,
  score: null,
  source: 'manual',
  estimate_is_ai: false,
  is_locked: false,
  enc_blob: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  deleted_at: null,
  rev: 0,
} as const;

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  area: { minHeight: 72, textAlignVertical: 'top' },
  step: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: sp[2] },
  box: { width: 20, height: 20, borderWidth: 1.5, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: sp[2], padding: sp[3], borderRadius: radius.md },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  submit: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

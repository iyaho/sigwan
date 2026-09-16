import { GRADE_COLOR, GRADE_LABEL, KIND_LABEL, dueFields, dueParts, priorityScore } from '@sigwan/core';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { TIME_CHIPS, fmtEst, fmtYmd, shiftYmd } from '../dateChips';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';
import { Chip, Field, Row, Sheet } from './Sheet';

/** 선택된 할 일의 상세 — 웹 TaskDetail과 같은 것들을 손댈 수 있어야 한다 */
export function TaskDetailSheet() {
  const th = useTheme();
  const { tasks, tags, taskTags, blocks, selectedTaskId, select, saveTask, removeTask, removeBlock, setTaskTags } =
    useStore();
  const task = tasks.find((t) => t.id === selectedTaskId);

  const [title, setTitle] = useState('');
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (task) setTitle(task.title);
    setArmed(false);
  }, [task]);

  if (!task) return null;

  const s = priorityScore(task);
  const { dateStr, timeStr } = dueParts(task);
  const myTags = taskTags[task.id] ?? [];
  const myBlocks = blocks.filter((b) => b.task_id === task.id && !b.deleted_at);
  const kids = tasks.filter((t) => t.parent_id === task.id && !t.deleted_at);

  // 마감을 고치면 kind가 따라 바뀐다 (3.3-3)
  const setDue = (d: string | null, t: string) => saveTask({ ...task, ...dueFields(d, t) });

  return (
    <Sheet open onClose={() => select(null)} title={KIND_LABEL[task.kind]}>
      <Field label="제목">
        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={() => {
            const v = title.trim();
            if (!v) setTitle(task.title);
            else if (v !== task.title) saveTask({ ...task, title: v });
          }}
          style={[styles.input, { borderColor: th.borderStrong, color: th.text, backgroundColor: th.bg }]}
        />
      </Field>

      <Field
        label="마감"
        hint={
          task.kind === 'someday'
            ? '날짜가 없어 인박스에 있다 — 급한 순 정렬에서 빠진다'
            : task.kind === 'day'
              ? '암묵 마감 23:59. 시각을 넣으면 기한 투두가 된다'
              : undefined
        }
      >
        {dateStr ? (
          <View style={{ gap: 6 }}>
            <Row>
              <Pressable onPress={() => setDue(shiftYmd(dateStr, -1), timeStr)} style={[styles.step, { borderColor: th.borderStrong }]}>
                <Text style={{ color: th.textDim }}>◀</Text>
              </Pressable>
              <Text style={{ color: th.text, fontSize: 13, minWidth: 110, textAlign: 'center' }}>{fmtYmd(dateStr)}</Text>
              <Pressable onPress={() => setDue(shiftYmd(dateStr, 1), timeStr)} style={[styles.step, { borderColor: th.borderStrong }]}>
                <Text style={{ color: th.textDim }}>▶</Text>
              </Pressable>
              <Pressable onPress={() => setDue(null, '')} style={[styles.step, { borderColor: th.borderStrong }]}>
                <Text style={{ color: th.textDim, fontSize: 12 }}>지우기</Text>
              </Pressable>
            </Row>
            <Row>
              {TIME_CHIPS.map((t) => (
                <Chip key={t || 'none'} small label={t || '종일'} on={timeStr === t} onPress={() => setDue(dateStr, t)} />
              ))}
            </Row>
          </View>
        ) : (
          <Row>
            <Chip label="오늘로" on={false} onPress={() => setDue(todayYmd(), '')} />
            <Chip label="내일로" on={false} onPress={() => setDue(shiftYmd(todayYmd(), 1), '')} />
          </Row>
        )}
      </Field>

      <Field label="예상">
        <Row>
          <Pressable onPress={() => saveTask({ ...task, estimate_min: Math.max(5, task.estimate_min - 15) })} style={[styles.step, { borderColor: th.borderStrong }]}>
            <Text style={{ color: th.textDim }}>−15</Text>
          </Pressable>
          <Text style={{ color: th.text, fontSize: 13, minWidth: 70, textAlign: 'center' }}>{fmtEst(task.estimate_min)}</Text>
          <Pressable onPress={() => saveTask({ ...task, estimate_min: task.estimate_min + 15 })} style={[styles.step, { borderColor: th.borderStrong }]}>
            <Text style={{ color: th.textDim }}>+15</Text>
          </Pressable>
          {task.estimate_is_ai && (
            <View style={[styles.aiBadge, { borderColor: th.borderStrong }]}>
              <Text style={{ color: th.textFaint, fontSize: 11 }}>AI 추정</Text>
            </View>
          )}
        </Row>
      </Field>

      <Field label="중요도">
        <Row>
          {[1, 2, 3, 4, 5].map((v) => (
            <Chip key={v} label={String(v)} on={task.importance === v} onPress={() => saveTask({ ...task, importance: v })} />
          ))}
        </Row>
      </Field>

      <Field label="태그">
        <Row>
          {tags.map((t) => (
            <Chip
              key={t.id}
              small
              dot={t.color}
              label={t.name}
              on={myTags.includes(t.id)}
              onPress={() =>
                setTaskTags(task.id, myTags.includes(t.id) ? myTags.filter((x) => x !== t.id) : [...myTags, t.id])
              }
            />
          ))}
        </Row>
      </Field>

      {kids.length > 0 && (
        <Field label="하위">
          <View style={[styles.bar, { backgroundColor: th.sunken }]}>
            <View style={[styles.barFill, { width: `${task.progress * 100}%`, backgroundColor: th.accent }]} />
          </View>
          <Text style={{ color: th.textFaint, fontSize: 12 }}>
            {kids.filter((k) => k.status === 'done').length}/{kids.length} 완료 · 자동 계산
          </Text>
        </Field>
      )}

      <Field label="블록">
        {myBlocks.length ? (
          <View style={{ gap: 4 }}>
            {myBlocks
              .slice()
              .sort((a, b) => a.start_at.localeCompare(b.start_at))
              .map((b) => (
                <View key={b.id} style={styles.blockRow}>
                  <Text style={{ color: th.textDim, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                    {fmtRange(b.start_at, b.end_at)}
                  </Text>
                  <Pressable onPress={() => removeBlock(b.id)} hitSlop={8}>
                    <Text style={{ color: th.textFaint, fontSize: 14 }}>✕</Text>
                  </Pressable>
                </View>
              ))}
          </View>
        ) : (
          <Text style={{ color: th.textFaint, fontSize: 12 }}>미스케줄</Text>
        )}
      </Field>

      <View style={[styles.score, { backgroundColor: th.sunken }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp[2] }}>
          <Text style={[styles.scoreNum, { color: th.text }]}>
            {Number.isFinite(s.score) ? s.score.toFixed(1) : '—'}
          </Text>
          <View style={[styles.pill, { backgroundColor: GRADE_COLOR[s.grade] }]}>
            <Text style={styles.pillText}>{task.kind === 'someday' ? '인박스' : GRADE_LABEL[s.grade]}</Text>
          </View>
        </View>
        {s.reasons.map((r) => (
          <Text key={r} style={{ color: th.textFaint, fontSize: 11, marginTop: 2 }}>
            · {r}
          </Text>
        ))}
      </View>

      <Pressable
        onPress={() => (armed ? removeTask(task.id) : setArmed(true))}
        style={[styles.del, { borderColor: armed ? GRADE_COLOR.now : th.border, backgroundColor: armed ? GRADE_COLOR.now : 'transparent' }]}
      >
        <Text style={{ color: armed ? '#fff' : th.textDim, fontSize: 13 }}>
          {armed
            ? `정말 지울까? (${kids.length ? `하위 ${kids.length}개 · ` : ''}블록 ${myBlocks.length}개 함께)`
            : '할 일 삭제'}
        </Text>
      </Pressable>
    </Sheet>
  );
}

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function fmtRange(a: string, b: string) {
  const s = new Date(a);
  const e = new Date(b);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${s.getMonth() + 1}/${s.getDate()} ${p2(s.getHours())}:${p2(s.getMinutes())}–${p2(e.getHours())}:${p2(e.getMinutes())}`;
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, fontWeight: '600' },
  step: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 11, paddingVertical: 7 },
  aiBadge: { borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  bar: { height: 6, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  blockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  score: { padding: sp[3], borderRadius: radius.md },
  scoreNum: { fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  del: { borderWidth: 1, borderRadius: radius.md, padding: 12, alignItems: 'center' },
});

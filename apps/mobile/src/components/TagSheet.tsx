import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStore } from '../store';
import { radius, sp, useTheme } from '../theme';
import { ROUTINE_COLORS } from './RoutineSheet';
import { Field, Row, Sheet } from './Sheet';

/**
 * 3.4 태그 관리 — 앱에는 진입점이 아예 없어서 웹에서만 만들 수 있었다.
 *
 * 계층은 없다. 필요하면 이름에 슬래시를 쓴다.
 * 삭제는 두 번 눌러야 한다 — Alert는 화면을 통째로 막아서 쓰지 않는다.
 */
export function TagSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const th = useTheme();
  const { tags, taskTags, addTag, updateTag, removeTag } = useStore();
  const [name, setName] = useState('');
  const [color, setColor] = useState(ROUTINE_COLORS[0] as string);
  const [dup, setDup] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  /** 지우기 전에 얼마나 물려 있는지 보여준다 */
  const usage: Record<string, number> = {};
  for (const ids of Object.values(taskTags)) for (const id of ids) usage[id] = (usage[id] ?? 0) + 1;

  async function submit() {
    const id = await addTag(name, color);
    if (id === null) {
      setDup(true);
      return;
    }
    setName('');
    setDup(false);
    setColor(ROUTINE_COLORS[(tags.length + 1) % ROUTINE_COLORS.length] as string);
  }

  return (
    <Sheet open={open} onClose={onClose} title="태그">
      <Field label="새 태그" hint={dup ? undefined : '색은 막대·칩에 쓰인다'}>
        <View style={{ flexDirection: 'row', gap: sp[2] }}>
          <TextInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              setDup(false);
            }}
            placeholder="태그 이름"
            placeholderTextColor={th.textFaint}
            maxLength={50}
            onSubmitEditing={submit}
            style={[styles.input, { borderColor: th.borderStrong, color: th.text, backgroundColor: th.bg }]}
          />
          <Pressable
            onPress={submit}
            disabled={!name.trim()}
            style={[styles.add, { backgroundColor: name.trim() ? th.accent : th.borderStrong }]}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>추가</Text>
          </Pressable>
        </View>
        {dup && <Text style={{ color: '#e5484d', fontSize: 12 }}>같은 이름이 이미 있다</Text>}
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

      <Field label={`목록 · ${tags.length}개`}>
        {tags.map((t) => (
          <View key={t.id} style={[styles.row, { borderBottomColor: th.border }]}>
            <Pressable
              onPress={() => {
                const i = ROUTINE_COLORS.indexOf(t.color);
                updateTag(t.id, { color: ROUTINE_COLORS[(i + 1) % ROUTINE_COLORS.length] as string });
              }}
              hitSlop={8}
              style={[styles.dot, { backgroundColor: t.color }]}
            />
            <TextInput
              defaultValue={t.name}
              onEndEditing={(e) => {
                const v = e.nativeEvent.text.trim();
                if (v && v !== t.name) updateTag(t.id, { name: v });
              }}
              maxLength={50}
              style={{ flex: 1, color: th.text, fontSize: 15, paddingVertical: 6 }}
            />
            <Text style={{ color: th.textFaint, fontSize: 12 }}>{usage[t.id] ?? 0}</Text>
            <Pressable
              onPress={() => (armed === t.id ? removeTag(t.id) : setArmed(t.id))}
              hitSlop={8}
              style={[styles.del, armed === t.id && { backgroundColor: '#e5484d', borderColor: '#e5484d' }, { borderColor: th.border }]}
            >
              <Text style={{ fontSize: 11, color: armed === t.id ? '#fff' : th.textFaint }}>
                {armed === t.id ? `정말? (${usage[t.id] ?? 0})` : '✕'}
              </Text>
            </Pressable>
          </View>
        ))}
        {!tags.length && <Text style={{ color: th.textFaint, fontSize: 12 }}>아직 없다.</Text>}
      </Field>

      <Text style={{ color: th.textFaint, fontSize: 11, lineHeight: 16 }}>
        동그라미를 누르면 색이 바뀐다. 이름은 눌러서 고치고, 지우기는 두 번 눌러야 한다.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  add: { borderRadius: radius.md, paddingHorizontal: 16, justifyContent: 'center' },
  swatch: { width: 24, height: 24, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp[2], borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 14, height: 14, borderRadius: 999 },
  del: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 },
});

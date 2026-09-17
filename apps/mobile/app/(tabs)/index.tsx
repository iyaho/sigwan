import type { ViewKey } from '@sigwan/core';
import { completedGroups, filterByView, matchesQuery, sortByPriority, viewProgress } from '@sigwan/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddTaskSheet } from '@/components/AddTaskSheet';
import { Fab } from '@/components/Fab';
import { Onboarding } from '@/components/Onboarding';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { TaskRow } from '@/components/TaskRow';
import { UpNext } from '@/components/UpNext';
import { useStore } from '@/store';
import { radius, sp, useTheme } from '@/theme';

/**
 * 일정 탭 — 기본 화면 (12장). 원래 '오늘'과 '전체'가 탭 두 개였는데 하나로 합쳤다.
 *
 * 둘은 같은 목록에 기간 조건만 다른 것이었고, 탭을 하나 비워 '시간표'를 넣을 자리를 만들었다.
 * 뷰는 제목을 눌러 바꾼다 — 전체 화면 모달로 덮지 않는다. 덮으면 고르는 동안 아래 목록이
 * 안 보여서 무엇을 고르는지 감이 안 온다.
 */

const MAIN: [ViewKey, string][] = [
  ['today', '오늘'],
  ['next7', '1주'],
  ['month', '월'],
  ['all', '전체'],
];
/** 인박스로 가는 길이 앱에 없었다. AI 생성 초안이 전부 여기로 들어온다 (3.7.1) */
const EXTRA: [ViewKey, string][] = [
  ['inbox', '인박스'],
  ['done', '완료함'],
];

export default function ScheduleScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { tasks, tags, taskTags, toggleDone, select } = useStore();
  const [view, setView] = useState<ViewKey>('today');
  const [menu, setMenu] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const router = useRouter();

  /** 뷰 → 태그 → 검색 순으로 좁힌다. 검색은 지금 보고 있는 뷰 안에서만 찾는다 */
  const narrowed = useMemo(() => {
    let list = filterByView(tasks, view);
    if (tagFilter.length) list = list.filter((t) => (taskTags[t.id] ?? []).some((id) => tagFilter.includes(id)));
    if (q.trim()) list = list.filter((t) => matchesQuery(t, q));
    return list;
  }, [tasks, taskTags, view, tagFilter, q]);

  const rows = useMemo(() => sortByPriority(narrowed), [narrowed]);

  /** 완료함은 급한 순이 의미가 없다. 끝낸 날짜로 묶는다 */
  const sections = useMemo(
    () => (view === 'done' ? completedGroups(narrowed).map((g) => ({ ...g, data: g.tasks })) : []),
    [view, narrowed],
  );

  /** 뷰 밖에서는 몇 개가 걸리는지 — 결과가 0일 때 「전체에서 찾기」를 권하려고 */
  const hitsElsewhere = useMemo(() => {
    if (!q.trim() || view === 'all' || rows.length) return 0;
    return filterByView(tasks, 'all').filter((t) => matchesQuery(t, q)).length;
  }, [q, view, rows.length, tasks]);

  /** 메뉴에 붙일 개수. 태그 필터는 빼고 센다 — 필터를 걸어둔 채 다른 뷰의 크기를 보고 싶기 때문 */
  const counts = useMemo(() => {
    const m: Partial<Record<ViewKey, number>> = {};
    for (const [k] of [...MAIN, ...EXTRA]) m[k] = filterByView(tasks, k).length;
    return m;
  }, [tasks]);

  const prog = useMemo(() => viewProgress(tasks, view), [tasks, view]);
  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : null;
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const label = [...MAIN, ...EXTRA].find(([k]) => k === view)?.[1] ?? '오늘';
  const sub =
    view === 'today'
      ? new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
      : view === 'next7'
        ? '앞으로 7일'
        : view === 'month'
          ? '앞으로 30일'
          : `급한 순 · ${rows.length}개`;

  const renderRow = (item: (typeof rows)[number]) => (
    <TaskRow
      task={item}
      tags={(taskTags[item.id] ?? []).map((id) => tagById.get(id)).filter((x): x is NonNullable<typeof x> => !!x)}
      onToggle={() => toggleDone(item.id)}
      onPress={() => select(item.id)}
    />
  );

  const emptyText = q.trim()
    ? `"${q.trim()}"로 걸리는 게 없다.`
    : tagFilter.length
      ? '이 태그로는 걸리는 게 없다.'
      : `${label}은(는) 비어 있다.`;

  const Item = ({ k, name }: { k: ViewKey; name: string }) => (
    <Pressable
      onPress={() => {
        setView(k);
        setMenu(false);
      }}
      style={[styles.item, view === k && { backgroundColor: th.accentSoft }]}
    >
      <Text style={{ fontSize: 15, color: view === k ? th.accent : th.text, fontWeight: view === k ? '700' : '400' }}>
        {name}
      </Text>
      <Text style={{ fontSize: 12, color: th.textFaint }}>{counts[k] ?? 0}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
      <View style={[styles.head, { borderBottomColor: th.border }]}>
        <Pressable onPress={() => setMenu((v) => !v)} style={{ flex: 1 }} hitSlop={8}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.h1, { color: th.text }]}>{label}</Text>
            <Text style={{ color: th.textFaint, fontSize: 14, marginTop: 4 }}>{menu ? '▴' : '▾'}</Text>
          </View>
          <Text style={[styles.sub, { color: th.textFaint }]}>{sub}</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            setSearching((v) => !v);
            if (searching) setQ('');
          }}
          hitSlop={10}
          style={[styles.magnifier, { borderColor: searching ? th.accent : th.border }]}
        >
          <Text style={{ fontSize: 13, color: searching ? th.accent : th.textDim }}>
            {searching ? '닫기' : '검색'}
          </Text>
        </Pressable>

        {pct !== null && !searching && (
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.pct, { color: th.text }]}>{pct}%</Text>
            <View style={[styles.bar, { backgroundColor: th.sunken }]}>
              <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: th.accent }]} />
            </View>
            <Text style={[styles.sub, { color: th.textFaint }]}>
              {prog?.done}/{prog?.total} 완료
            </Text>
          </View>
        )}
      </View>

      {/* 헤더 바로 아래로 내려오는 메뉴. 바깥을 누르면 닫힌다 */}
      {menu && (
        <View style={[styles.menu, { backgroundColor: th.panel, borderBottomColor: th.border }]}>
          {MAIN.map(([k, name]) => (
            <Item key={k} k={k} name={name} />
          ))}
          <View style={[styles.sep, { backgroundColor: th.border }]} />
          {EXTRA.map(([k, name]) => (
            <Item key={k} k={k} name={name} />
          ))}
        </View>
      )}

      {searching && (
        <View style={[styles.searchRow, { borderBottomColor: th.border }]}>
          {/* biome-ignore lint/a11y/noAutofocus: 돋보기를 누른 이유가 이 칸이다 */}
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder="제목·메모에서 찾기"
            placeholderTextColor={th.textFaint}
            style={[styles.search, { borderColor: th.borderStrong, color: th.text, backgroundColor: th.bg }]}
            returnKeyType="search"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={8}>
              <Text style={{ color: th.textFaint, fontSize: 16 }}>✕</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* 필터 줄은 가로 스크롤이면 8개 중 4개만 보이고 나머지는 잘린다 —
          숨은 선택지는 없는 선택지다. 줄바꿈으로 전부 보여준다. */}
      {tags.length > 0 && (
        <View style={styles.chips}>
          {tagFilter.length > 0 && (
            <Pressable
              onPress={() => setTagFilter([])}
              style={[styles.chip, { borderColor: th.borderStrong, backgroundColor: th.panel }]}
            >
              <Text style={{ fontSize: 12, color: th.textDim }}>✕ 초기화</Text>
            </Pressable>
          )}
          {tags.map((t) => {
            const on = tagFilter.includes(t.id);
            return (
              <Pressable
                key={t.id}
                onPress={() => setTagFilter((f) => (on ? f.filter((x) => x !== t.id) : [...f, t.id]))}
                style={[
                  styles.chip,
                  { borderColor: on ? th.accent : th.borderStrong, backgroundColor: on ? th.accentSoft : th.panel },
                ]}
              >
                <View style={[styles.dot, { backgroundColor: t.color }]} />
                <Text style={[styles.chipText, { color: on ? th.accent : th.textDim }]}>{t.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {view === 'done' ? (
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHead, { backgroundColor: th.bg, borderBottomColor: th.border }]}>
              <Text style={{ color: th.textDim, fontSize: 12, fontWeight: '700' }}>{section.label}</Text>
              <Text style={{ color: th.textFaint, fontSize: 11 }}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item }) => renderRow(item)}
          ListEmptyComponent={<Text style={[styles.empty, { color: th.textFaint }]}>{emptyText}</Text>}
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        />
      ) : (
        <FlatList
          ListHeaderComponent={
            // 「지금부터 6시간」은 오늘일 때만 말이 된다 (3.5 위젯과 같은 창)
            view === 'today' && !q.trim() ? (
              <View style={{ paddingVertical: 10 }}>
                <UpNext onOpenTimeline={() => router.push('/timeline')} />
              </View>
            ) : null
          }
          data={rows}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => renderRow(item)}
          ListEmptyComponent={
            <View>
              <Text style={[styles.empty, { color: th.textFaint }]}>{emptyText}</Text>
              {hitsElsewhere > 0 && (
                <Pressable onPress={() => setView('all')} style={{ alignItems: 'center' }}>
                  <Text style={{ color: th.accent, fontSize: 13, fontWeight: '600' }}>
                    전체에서 찾기 ({hitsElsewhere}개)
                  </Text>
                </Pressable>
              )}
            </View>
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        />
      )}

      <Fab onPress={() => setAddOpen(true)} />
      <AddTaskSheet open={addOpen} onClose={() => setAddOpen(false)} defaultTagIds={tagFilter} />
      <TaskDetailSheet />
      <Onboarding onAddTask={() => setAddOpen(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth, gap: sp[3] },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  sub: { fontSize: 12, marginTop: 2 },
  pct: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bar: { width: 96, height: 6, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  /** 헤더 아래에 끼어들어 목록을 밀어낸다. 절대 배치를 쓰지 않는 이유는 위 주석 참조 */
  menu: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: sp[4], paddingVertical: 11, borderRadius: radius.md, marginHorizontal: 6 },
  sep: { height: StyleSheet.hairlineWidth, marginVertical: 5, marginHorizontal: sp[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: sp[4], paddingTop: sp[2] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 12 },
  dot: { width: 7, height: 7, borderRadius: 999 },
  empty: { textAlign: 'center', padding: sp[5], fontSize: 13 },
  magnifier: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: sp[2], paddingHorizontal: sp[4], paddingVertical: sp[2], borderBottomWidth: StyleSheet.hairlineWidth },
  search: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: sp[4], paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
});

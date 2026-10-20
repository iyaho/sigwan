import { TODAY_WIDGET_LIMIT, todayWidgetData } from '@sigwan/core';
import { Platform } from 'react-native';
import type { WidgetInfo, WidgetRepresentation } from 'react-native-android-widget';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { useStore } from '../store';
import { dark, light } from '../theme';
import { CHROME_H, ROW_H, TodayWidget, TodayWidgetError } from './TodayWidget';

/** app.json plugins.react-native-android-widget.widgets[].name과 같아야 한다 */
export const TODAY = 'Today';

/**
 * 위젯은 앱과 **같은 JS 런타임의 같은 store**를 본다.
 *
 * 안드로이드는 headless task를 앱 프로세스의 React 인스턴스에서 돌린다. 앱이 떠 있으면 이미 로드된
 * store를 그대로 쓰고, 안 떠 있으면 여기서 load()가 처음 불린다 — 앱 화면이 쓰는 그 경로 그대로.
 * 위젯 전용 SQL을 따로 두지 않는 이유: 두 벌이면 언젠가 다른 답을 낸다 (3.5).
 */
async function ensureLoaded(): Promise<boolean> {
  if (!useStore.getState().ready) await useStore.getState().load();
  return useStore.getState().ready;
}

/** 위젯 높이에 들어가는 줄 수. 크기를 줄이면 줄도 준다 (resizeMode) */
function rowsFor(info: WidgetInfo) {
  return Math.max(1, Math.min(TODAY_WIDGET_LIMIT, Math.floor((info.height - CHROME_H) / ROW_H)));
}

export async function renderToday(info: WidgetInfo): Promise<WidgetRepresentation> {
  if (!(await ensureLoaded())) {
    return { light: <TodayWidgetError th={light} />, dark: <TodayWidgetError th={dark} /> };
  }
  const data = todayWidgetData(useStore.getState().tasks, new Date());
  const rows = rowsFor(info);
  return {
    light: <TodayWidget data={data} rows={rows} th={light} />,
    dark: <TodayWidget data={data} rows={rows} th={dark} />,
  };
}

/** 위젯에서 체크박스를 눌렀다. 앱에서 누른 것과 같은 액션 — 하위작업이면 부모 진행률도 같이 바뀐다 */
export async function toggleFromWidget(taskId: string) {
  if (!(await ensureLoaded())) return;
  await useStore.getState().toggleDone(taskId);
}

/**
 * 3.5 갱신 경로 중 「데이터 변경 시 push」. 앱에서 할 일이 바뀌면 홈 화면 위젯을 다시 그린다.
 * 나머지 둘 — 주기 갱신은 app.json의 updatePeriodMillis(안드로이드 하한 30분), 자정 알람은 아직 없다.
 *
 * 연달아 바뀌면(하위작업 체크 → 부모 진행률) 한 번만 그리도록 잠깐 모은다.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

export function startWidgetPush() {
  if (Platform.OS !== 'android' || started) return;
  started = true;
  useStore.subscribe((s, prev) => {
    if (!s.ready || s.tasks === prev.tasks) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      requestWidgetUpdate({ widgetName: TODAY, renderWidget: renderToday }).catch((e: unknown) => {
        console.warn('[widget] 갱신 실패', e);
      });
    }, 300);
  });
}

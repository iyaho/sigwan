import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { TOGGLE } from './TodayWidget';
import { renderToday, TODAY, toggleFromWidget } from './today';

/**
 * 위젯 이름 → 그리는 함수. 이름은 app.json의 plugins.react-native-android-widget.widgets[].name과
 * 정확히 같아야 한다. 어긋나면 위젯이 빈 채로 뜨고 에러도 안 난다.
 */
const nameToRender = {
  [TODAY]: renderToday,
} as const;

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const render = nameToRender[props.widgetInfo.widgetName as keyof typeof nameToRender];

  if (!render) {
    console.warn(`[widget] 등록되지 않은 위젯 이름: ${props.widgetInfo.widgetName}`);
    return;
  }

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(await render(props.widgetInfo));
      break;

    case 'WIDGET_CLICK': {
      // OPEN_APP·OPEN_URI는 네이티브가 처리하고 여기로 오지 않는다
      const id = props.clickActionData?.id;
      if (props.clickAction === TOGGLE && typeof id === 'string') await toggleFromWidget(id);
      props.renderWidget(await render(props.widgetInfo));
      break;
    }

    default:
      break;
  }
}

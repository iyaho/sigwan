import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { TodayWidget } from './TodayWidget';

/**
 * 위젯 이름 → 컴포넌트. 이름은 app.json의 plugins.react-native-android-widget.widgets[].name과
 * 정확히 같아야 한다. 어긋나면 위젯이 빈 채로 뜨고 에러도 안 난다.
 */
const nameToWidget = {
  Today: TodayWidget,
} as const;

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const name = props.widgetInfo.widgetName as keyof typeof nameToWidget;
  const Widget = nameToWidget[name];

  if (!Widget) {
    console.warn(`[widget] 등록되지 않은 위젯 이름: ${props.widgetInfo.widgetName}`);
    return;
  }

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(<Widget />);
      break;

    case 'WIDGET_CLICK':
      // 2차 — 체크박스 탭. 지금은 아무것도 하지 않는다.
      break;

    case 'WIDGET_DELETED':
      break;

    default:
      break;
  }
}

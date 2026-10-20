// expo-router/entry를 직접 main으로 쓰지 않고 이 파일을 거치는 이유:
// 위젯은 앱과 같은 JS 번들을 headless task로 다시 띄운다. 그 진입점에서
// registerWidgetTaskHandler가 반드시 불려야 하므로, 앱 등록 뒤에 한 줄 더 붙인다.
// package.json의 "main"이 이 파일을 가리켜야 한다.

import 'expo-router/entry';

import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { startWidgetPush } from './src/widgets/today';
import { widgetTaskHandler } from './src/widgets/widget-task-handler';

registerWidgetTaskHandler(widgetTaskHandler);
// 앱에서 할 일이 바뀌면 홈 화면 위젯도 다시 그린다 (3.5)
startWidgetPush();

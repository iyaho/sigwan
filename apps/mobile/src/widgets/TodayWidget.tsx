import { FlexWidget, TextWidget } from 'react-native-android-widget';

/**
 * 1차 관문용 위젯 — 데이터를 읽지 않는다.
 *
 * 위젯은 앱 프로세스가 아니라 headless JS task에서 렌더된다.
 * 그 환경에서 expo-sqlite가 열리는지는 아직 확인되지 않았으므로,
 * 우선 하드코딩만으로 "네이티브 빌드 + 홈 화면 등록"까지만 통과시킨다.
 * DB 연결은 그 다음 단계다 (명세 3.5).
 */
export function TodayWidget() {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        backgroundColor: '#16161a',
        borderRadius: 16,
        padding: 14,
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <TextWidget
        text="시관"
        style={{ fontSize: 12, color: '#8b8b95' }}
      />
      <TextWidget
        text="위젯 연결 확인"
        style={{ fontSize: 18, color: '#ffffff' }}
      />
      <TextWidget
        text="여기까지 보이면 네이티브 빌드는 통과"
        style={{ fontSize: 11, color: '#3e63dd' }}
      />
    </FlexWidget>
  );
}

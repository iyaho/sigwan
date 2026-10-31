import type { TodayWidgetData } from '@sigwan/core';
import type { HexColor } from 'react-native-android-widget';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { Theme } from '../theme';

/**
 * 3.5 「오늘」 위젯 (4×2) — 오늘 할 일 + 완료 수, 체크박스 탭.
 *
 * 무엇을 보여줄지는 core/todayWidgetData가 정한다. 여기는 그리기만 한다.
 * 위젯은 RN 뷰가 아니라 RemoteViews로 바뀌어 그려진다 — Pressable·스크롤·애니메이션이 없고,
 * 누름은 clickAction 문자열로 widget-task-handler에 전달된다.
 */

/** theme.ts 값은 그냥 string이라 위젯 색 타입으로 좁힌다 */
const c = (s: string) => s as HexColor;

/** 한 줄 높이(dp). 위젯 높이에서 몇 줄 들어가는지 셀 때도 쓴다 */
export const ROW_H = 26;
/** 머리줄 + 위아래 여백 + 「n개 더」 한 줄. 마지막 것을 빼면 그 줄이 아래로 잘려 나간다 */
export const CHROME_H = 70;

export const TOGGLE = 'TOGGLE';

export function TodayWidget({
  data,
  rows,
  th,
}: {
  data: TodayWidgetData;
  rows: number;
  th: Theme;
}) {
  const items = data.items.slice(0, rows);
  // 잘린 열린 할 일도 「n개 더」로 센다 — 줄 수가 위젯 크기에 따라 다섯보다 적을 수 있다
  const hidden = data.more + data.items.slice(rows).filter((i) => !i.done).length;
  const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        width: 'match_parent',
        height: 'match_parent',
        backgroundColor: c(th.panel),
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'column',
      }}
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <TextWidget text="오늘" style={{ fontSize: 15, fontWeight: '700', color: c(th.text) }} />
        <TextWidget text={`  ${data.dateLabel}`} style={{ fontSize: 11, color: c(th.textFaint) }} />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget
          text={data.total ? `${data.done}/${data.total} · ${pct}%` : ''}
          style={{ fontSize: 12, fontWeight: '600', color: c(th.textDim) }}
        />
      </FlexWidget>

      {items.length === 0 ? (
        <FlexWidget
          style={{ flex: 1, width: 'match_parent', justifyContent: 'center', alignItems: 'center' }}
        >
          <TextWidget
            text={data.total ? '오늘 할 일을 다 끝냈다' : '오늘은 비어 있다'}
            style={{ fontSize: 13, color: c(th.textFaint) }}
          />
        </FlexWidget>
      ) : (
        items.map((it) => (
          <FlexWidget
            key={it.id}
            style={{
              width: 'match_parent',
              height: ROW_H,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            {/* 누르는 자리를 상자보다 넓게 잡는다 — 16dp 상자만 받으면 손가락이 자꾸 제목을 누른다 */}
            <FlexWidget
              clickAction={TOGGLE}
              clickActionData={{ id: it.id }}
              accessibilityLabel={it.done ? `${it.title} 완료 취소` : `${it.title} 완료`}
              style={{
                width: 30,
                height: ROW_H,
                justifyContent: 'center',
                alignItems: 'flex-start',
              }}
            >
              <FlexWidget
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  borderWidth: 1.5,
                  borderColor: c(it.done ? th.accent : (it.color ?? th.borderStrong)),
                  backgroundColor: c(it.done ? th.accent : th.panel),
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                {it.done ? (
                  <TextWidget text="✓" style={{ fontSize: 10, color: '#ffffff' }} />
                ) : null}
              </FlexWidget>
            </FlexWidget>

            <FlexWidget
              clickAction="OPEN_URI"
              clickActionData={{ uri: `sigwan:///?task=${it.id}` }}
              style={{ flex: 1, height: ROW_H, flexDirection: 'row', alignItems: 'center' }}
            >
              {/* TextWidget은 flex를 못 받는다. 감싼 쪽이 남는 폭을 먹고 글자는 그 안에서 잘린다 */}
              <FlexWidget style={{ flex: 1 }}>
                <TextWidget
                  text={it.title}
                  maxLines={1}
                  truncate="END"
                  style={{
                    width: 'match_parent',
                    fontSize: 13,
                    color: c(it.done ? th.textFaint : th.text),
                  }}
                />
              </FlexWidget>
              {it.meta ? (
                <TextWidget
                  text={`  ${it.meta}`}
                  style={{ fontSize: 11, color: c(it.meta === '지남' ? th.nowLine : th.textFaint) }}
                />
              ) : null}
            </FlexWidget>
          </FlexWidget>
        ))
      )}

      {hidden > 0 && items.length > 0 ? (
        <TextWidget
          text={`+${hidden}개 더`}
          style={{ fontSize: 11, color: c(th.textFaint), marginTop: 2 }}
        />
      ) : null}
    </FlexWidget>
  );
}

/** DB를 못 열었을 때. 빈 위젯은 "고장"인지 "할 일 없음"인지 구분이 안 된다 */
export function TodayWidgetError({ th }: { th: Theme }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        width: 'match_parent',
        height: 'match_parent',
        backgroundColor: c(th.panel),
        borderRadius: 16,
        padding: 14,
        justifyContent: 'center',
      }}
    >
      <TextWidget text="시관" style={{ fontSize: 12, color: c(th.textFaint) }} />
      <TextWidget
        text="할 일을 못 읽었다 — 눌러서 앱 열기"
        style={{ fontSize: 13, color: c(th.text) }}
      />
    </FlexWidget>
  );
}

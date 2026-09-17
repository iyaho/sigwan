/** 3.3-2 날짜·시각 칩. 네이티브 날짜 피커는 모듈 추가 = 재빌드라, 칩 + 하루 단위 조절로 간다. */
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const add = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};
/** 다가오는 토요일 (오늘이 토요일이면 오늘) */
const nextSat = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d;
};
/** 다음 주 월요일 */
const nextMon = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
};

export const DATE_CHIPS: { label: string; get: () => string | null }[] = [
  { label: '없음', get: () => null },
  { label: '오늘', get: () => ymd(new Date()) },
  { label: '내일', get: () => ymd(add(1)) },
  { label: '이번 주말', get: () => ymd(nextSat()) },
  { label: '다음 주', get: () => ymd(nextMon()) },
];

export const TIME_CHIPS = ['', '09:00', '13:00', '18:00', '23:59'];
export const EST_CHIPS: [string, number][] = [
  ['15분', 15],
  ['30분', 30],
  ['1시간', 60],
  ['2시간', 120],
  ['4시간', 240],
];

/** 날짜 문자열을 n일 옮긴다 */
export function shiftYmd(s: string, days: number) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y as number, (m as number) - 1, d as number);
  dt.setDate(dt.getDate() + days);
  return ymd(dt);
}

/**
 * 'YYYY-MM-DD' → '2027년 3월 2일 (화)'.
 *
 * 연도를 늘 붙인다. 달력에서 내년을 고를 수 있게 된 이상, 표시에 연도가 없으면
 * 「3월 2일」이 올해인지 내년인지 화면만 보고는 알 수가 없다.
 * 시각(T12:00:00)을 붙여 파싱하는 이유는 자정으로 읽으면 타임존에 따라 전날이 되기 때문이다.
 */
export function fmtYmd(s: string) {
  const [y, m, d] = s.split('-');
  const dt = new Date(`${s}T12:00:00`);
  const w = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
  return `${y}년 ${Number(m)}월 ${Number(d)}일 (${w})`;
}

export function fmtEst(min: number) {
  return min >= 60 ? `${(min / 60).toFixed(min % 60 ? 1 : 0)}시간` : `${min}분`;
}

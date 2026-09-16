/**
 * 마감 임박도(U, 0~100) → 색. 멀면 옅은 회색, 다가올수록 붉고 진해진다.
 * U는 점수 공식의 그 U라 리스트 순서와 색이 같은 숫자에서 나온다.
 */
export function urgencyColor(u: number): string {
  const pct = Math.round(Math.min(100, Math.max(0, u)));
  return `color-mix(in oklab, var(--grade-now) ${pct}%, var(--border-strong))`;
}

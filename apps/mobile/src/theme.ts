/**
 * 디자인 토큰 — 웹 tokens.css와 같은 값. 두 곳이 어긋나면 위젯·웹·앱이 다른 앱처럼 보인다.
 * 등급색은 core의 GRADE_COLOR를 그대로 쓰고, 여기는 바탕·글자·간격만.
 */
import { useColorScheme } from 'react-native';

export const light = {
  bg: '#fcfcfd',
  panel: '#ffffff',
  sunken: '#f4f4f6',
  border: '#e3e3e8',
  borderStrong: '#cdced6',
  text: '#1c1c1f',
  textDim: '#6b6b75',
  textFaint: '#9a9aa4',
  accent: '#3e63dd',
  accentSoft: '#e6ebfe',
  nowLine: '#e5484d',
};
export const dark: typeof light = {
  bg: '#111113',
  panel: '#18181b',
  sunken: '#1f1f23',
  border: '#2a2a2f',
  borderStrong: '#3d3d44',
  text: '#eeeef0',
  textDim: '#a0a0aa',
  textFaint: '#6e6e78',
  accent: '#6e8dfb',
  accentSoft: '#1e2440',
  nowLine: '#e5484d',
};
export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const sp = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24 } as const;
export const radius = { sm: 4, md: 8, lg: 12 } as const;

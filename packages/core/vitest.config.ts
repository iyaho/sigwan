import { defineConfig } from 'vitest/config';

// 검산표가 KST 기준이다. day_of(로컬 날짜) 계산도 타임존에 걸리므로 고정한다.
process.env.TZ = 'Asia/Seoul';

export default defineConfig({
  test: { environment: 'node', globals: false },
});

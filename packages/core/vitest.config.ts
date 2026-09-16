import { defineConfig } from 'vitest/config';

// 검산표가 KST 기준이다. day_of(로컬 날짜) 계산도 타임존에 걸리므로 고정한다.
// 스크립트에 `TZ=... vitest`로 쓰면 윈도우 cmd에서 깨지므로 여기서만 잡는다.
// 이 파일은 워커가 뜨기 전에 메인 프로세스에서 읽히고, 워커는 이 env를 물려받는다.
process.env.TZ = 'Asia/Seoul';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    env: { TZ: 'Asia/Seoul' },
  },
});

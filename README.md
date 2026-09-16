# 시관 (sigwan)

시간 관리 앱 — 웹 + 안드로이드. 설계 명세는 프로젝트 문서 `claude/설계명세.md`.

```
packages/core   타입 · 점수 함수 · 타임라인 좌표계 · 달력 · 자동 배치 규칙 · Repository 인터페이스
apps/web        React + Vite        (Dexie / IndexedDB)
apps/mobile     Expo + React Native (expo-sqlite)
```

**웹과 앱은 `packages/core`를 같이 쓴다.** 점수·좌표·날짜 계산이 한 곳에만 있고, 화면은 그걸 부르기만 한다. 이게 이 리포의 유일한 구조적 약속이다 (→ [규칙](#규칙-두-개))

---

## 1. 처음 한 번만

**맥**

```bash
nvm install 24 && nvm use          # .nvmrc에 24로 고정돼 있다
npm install -g pnpm@10             # corepack 말고 npm으로 깐다 (이유는 4장)
```

**윈도우** — PowerShell에서. `winget` 뒤에는 **창을 새로 열어야** PATH가 잡힌다.

```powershell
winget install Git.Git OpenJS.NodeJS
# 창을 새로 연 뒤
npm install -g pnpm@10
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # pnpm.ps1 실행 차단 해제
```

**공통**

```bash
git clone https://github.com/iyaho/sigwan.git
cd sigwan
pnpm install
pnpm test          # 78개 통과하면 core가 정상이다
```

`pnpm test`가 통과하면 환경 확인은 끝이다. 웹만 할 사람은 2번으로, 앱까지 할 사람은 3번을 추가로 깐다.

> **윈도우에서 앱까지 할 거면 리포 경로에 한글을 넣지 말 것.** `C:\dev\sigwan` 같은 영문 경로에 두자. Gradle과 NDK가 한글 경로에서 간헐적으로 깨진다. 웹만 할 거면 상관없다.

---

## 2. 웹 실행 — 1분

```bash
pnpm dev           # http://localhost:5173
```

끝이다. 서버도 로그인도 없다. 첫 실행에 목 데이터(할 일 53 / 블록 30 / 태그 8)가 자동으로 들어가고, 전부 브라우저 IndexedDB에 저장된다.

- 어지럽히면 사이드바 맨 아래 **`dev · 목 데이터 리셋`** (개발 빌드에만 보인다)
- 단축키: `N` 추가 · `1`~`4` 줌 · `T` 오늘 · `/` 검색 · `[` 사이드바 접기 · `Esc` 닫기

---

## 3. 앱 실행 — 처음엔 한 시간쯤 걸린다

대부분 안드로이드 SDK 다운로드(20GB 가까이) 시간이다.

### 3-1. 도구 설치

**맥**

```bash
brew install --cask android-studio temurin@17   # 느리면 developer.android.com/studio 에서 직접 받아도 된다
npm install -g eas-cli
```

`~/.zshrc`에 추가:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

**윈도우**

```powershell
winget install Google.AndroidStudio EclipseAdoptium.Temurin.17.JDK
npm install -g eas-cli

setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-17.0.13.11-hotspot"   # 실제 설치된 폴더명으로
setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator"
```

`setx`는 **새 창부터** 적용된다. 그리고 `제어판 → Windows 기능 켜기/끄기`에서 **Windows 하이퍼바이저 플랫폼**을 켠다 — 에뮬레이터 가속이 여기 달려 있다.

**공통** — **Android Studio를 한 번 열어** 설치 마법사를 끝내고, SDK Manager에서 확인:

- SDK Platform **36** (Android 16) — 명세 13.2가 `targetSdk 36`을 요구한다
- Build-Tools, Platform-Tools, Emulator

셋 다 나오면 준비 끝:

```bash
adb --version
java -version      # 17.x 여야 한다
eas whoami
```

### 3-2. 에뮬레이터 켜기

Android Studio → **Device Manager** → 기기가 없으면 Create Virtual Device → Pixel 8 / API 36 → **▶**.
폰 화면이 홈까지 뜬 뒤:

```bash
adb devices        # emulator-5554  device  ← 이게 보여야 한다
```

실물 안드로이드 폰을 USB로 꽂고 개발자 옵션에서 USB 디버깅을 켜도 같은 자리에 잡힌다. **제스처(롱프레스·햅틱) 감은 실기기에서만 판단할 수 있다.**

### 3-3. 빌드 + 실행

```bash
cd apps/mobile
npx expo run:android
```

**첫 빌드는 5~10분.** Gradle이 의존성을 받고 네이티브를 컴파일한다. `BUILD SUCCESSFUL` 뒤 앱이 에뮬레이터에 깔리고 열린다.

두 번째부터는 **JS만 고칠 때 재빌드가 필요 없다** — Metro가 즉시 반영한다:

```bash
npx expo start --dev-client     # Metro만 띄우기
# 터미널에서 r = 새로고침, 캐시가 꼬이면 --clear 를 붙여 다시 띄운다
```

**재빌드가 필요한 때는 네이티브가 바뀔 때뿐이다** — `expo install`로 패키지를 추가했거나, `app.json`을 고쳤거나, 위젯(M4) 작업을 할 때.

---

## 4. 자주 막히는 곳

전부 실제로 밟은 것들이다.

| 증상 | 원인과 해결 |
|---|---|
| `pnpm` 실행하면 `dlx dlx dlx…` 무한 반복 | corepack이 띄운 pnpm이 자기 버전을 다시 받는 루프. `corepack disable` 후 `npm install -g pnpm@10`. 리포의 `.npmrc`에 `manage-package-manager-versions=false`가 들어 있는 이유 |
| `ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH` | `pnpm setup` 대신 위처럼 npm으로 깔면 안 만난다 |
| Gradle: `Worklets (0.12.2) is not compatible with Reanimated` | `react-native-worklets`는 **0.10.x**로 고정돼 있다(`apps/mobile/package.json`). peer 자동 설치가 0.12를 고르기 때문에 직접 의존성으로 박아뒀다. 건드리지 말 것 |
| Gradle이 이상하게 죽는다 | `java -version`이 17인지 먼저 본다. 21이면 `JAVA_HOME`을 위처럼 잡는다 |
| 앱이 빨간 화면 `undefined is not a function` | 대개 Metro 캐시. `npx expo start --dev-client --clear` |
| `ConfigError: /Users/…/package.json does not exist` | `apps/mobile`이 아닌 데서 expo 명령을 쳤다 |
| SQLite `database is locked` / `cannot rollback` | 쓰기를 `src/db/sqlite.ts`의 `withWrite()` 큐에 태우지 않았다. 연결이 하나라 트랜잭션이 겹치면 터진다 |
| `.git/index.lock: File exists` | 죽은 git 프로세스의 흔적. `rm -f .git/index.lock` (PowerShell은 `Remove-Item .git\*.lock -Force`) |
| (윈도우) `pnpm … 스크립트를 실행할 수 없으므로` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| (윈도우) 에뮬레이터가 검은 화면에서 멈춘다 | 하이퍼바이저를 다른 프로그램이 점유했다. VMware/VirtualBox 구버전을 끄거나 지운다 |
| (윈도우) Gradle이 경로에서 이상하게 죽는다 | 리포 경로에 한글이 있는지 본다. `C:\dev\sigwan`로 옮긴다 |

`npx expo-doctor`가 버전 불일치를 이름까지 찍어준다. 앱 쪽이 이상하면 먼저 돌려볼 것.

---

## 5. 지금 되는 것

**웹**

- 급한 순 정렬 (명세 4장 점수 공식, 등급색 스트라이프)
- 줌 4단계 — 일/주는 세로 열(드래그 편집), 월/분기는 달력 격자(기간 막대)
- 블록 드래그 이동·길이 조절(15분 스냅, `Alt`로 해제), 리스트로 끌어다 놓으면 블록 삭제
- 할 일 추가 폼(3.3) — 저장 전에 등급·점수·급한 순 순위를 보여준다
- 상세에서 제목·마감·예상·중요도·태그·메모 편집, 하위작업 진행률, 삭제
- 태그 CRUD, 검색(`/`), 패널 비율 드래그, 다크모드

**앱**

- 4탭(오늘·타임라인·전체·설정), 게스트 모드 온보딩 3화면
- 오늘 탭 — 「지금부터 6시간」 스트립 + 급한 순 리스트 + 진행도
- 타임라인 — 세로 하루 뷰, 롱프레스 드래그 이동·길이 조절, 빈 곳 길게 눌러 할 일 잡기
- 추가 폼·상세 시트는 웹과 같은 규칙(`core/taskDate.ts`)을 쓴다
- 로컬 SQLite — 명세 5장 스키마 + **outbox**(7장 동기화 계약, 서버가 없어도 미리 지킨다)

**아직 안 된 것** — 백엔드(M2, Supabase로 결정됨) · 위젯 3종(M4) · AI 할 일 생성(M4.5) · 한 줄 입력 파서 · 반복(RRULE) · 고정 일정·수면 입력과 자동 배치(core 규칙은 완성, 화면은 미착수)

---

## 규칙 두 개

1. **점수·좌표·날짜 계산을 화면 코드에서 하지 않는다.** `@sigwan/core`의 함수만 부른다.
   웹·앱·위젯이 같은 함수를 봐야 정렬이 어긋나지 않는다 (명세 11.1이 지목한 최대 리스크).
2. **`user_id` 조건을 화면 코드에 쓰지 않는다.** Repository 계층이 주입한다 (명세 10.1).
   한 군데만 빠져도 남의 데이터가 새는 자리다.

---

## 6. 올리기

원격은 `https://github.com/iyaho/sigwan.git` (HTTPS). 비밀번호 자리에는 GitHub 비밀번호가 아니라 **Personal Access Token**을 넣는다 — GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → 이 리포에 `Contents: Read and write`.

```bash
git switch -c feat/03-routine-ui     # main에 직접 커밋하지 않는다
git add -A
git commit -m "feat(mobile): 고정 일정 입력 화면"
git push -u origin feat/03-routine-ui
# 두 번째부터는 git push 만
```

올린 뒤 GitHub에서 Pull Request → 리뷰 → `main`에 merge.

```bash
git switch main && git pull        # 남이 merge한 걸 받아온다
pnpm install                       # package.json이 바뀌었을 수 있다
```

**막힐 때**

| 증상 | 해결 |
|---|---|
| `Permission denied (publickey)` | SSH 주소로 잡혀 있다. `git remote set-url origin https://github.com/iyaho/sigwan.git` |
| `.git/index.lock: File exists` | `rm -f .git/*.lock` · PowerShell은 `Remove-Item .git\*.lock -Force` |
| `! [rejected] ... fetch first` | 원격이 앞서 있다. `git pull --rebase` 후 다시 push |

브랜치는 `feat/<모듈번호>-<내용>`, `main`은 PR로만. 긴 브랜치 금지 (명세 16.9).

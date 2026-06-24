# for Marae — 카카오 이모티콘 다운로더

카카오 이모티콘샵 링크를 붙여넣으면 정지 이미지(PNG)와 움직이는 이모티콘(animated WebP)을
**미리보기 + 개별 저장 + 전체 ZIP 다운로드** 할 수 있는 개인용 로컬 웹앱입니다.

- `127.0.0.1`(localhost)에만 바인딩되는 로컬 전용 앱입니다. 외부에 노출하지 않습니다.
- 로그인은 **1회만** 합니다. 세션을 `session.json`에 저장해두고 계속 재사용하며, 만료될 때만 다시 로그인합니다.
- 정지 PNG는 로그인 없이도 받을 수 있고, 움직이는 WebP는 로그인된 세션이 있어야 받을 수 있습니다.

## 요구 사항

- Node.js ≥ 18

## 최초 1회 설정

```bash
npm run setup      # 의존성 설치 + playwright chromium 설치
npm run login       # 터미널에 아이디/비밀번호(+필요 시 인증번호) 입력 → 세션 저장
npm run up          # pm2로 서버 기동 + 부팅 목록 저장
```

`npm run login`은 화면(X서버) 없는 헤드리스 서버에서도 동작합니다. Playwright가
백그라운드(headless)로 카카오 로그인 페이지를 열고, 터미널에 입력한 아이디/비밀번호를
채워 제출합니다. 문자/카카오톡 인증번호 같은 추가 인증이 뜨면 화면에 보이는 입력칸을
인식해서 같은 방식으로 다시 물어봅니다.

카카오톡 앱으로 "로그인 승인" 알림을 받는 계정이면, 제출 후 화면에 에러 없이 같은
화면이 유지될 수 있습니다. 이 경우 `node login.js`가 "카카오톡 앱으로 로그인 승인
요청이 갔을 수 있어요"라고 안내하며 최대 90초까지 기다리니, 그동안 휴대폰 알림에서
승인을 눌러주세요.

`npm run login`은 **인터랙티브 1회 작업**이라 pm2로 띄우지 않습니다. 로그인이 끝나면
`session.json`이 생성되고, 이후에는 서버가 매 요청마다 이 파일을 읽어 로그인 상태를
재사용합니다.

> 카카오 로그인 화면 구조는 언제든 바뀔 수 있어서, 자동 입력이 입력란을 못 찾으면
> "아이디 입력란을 찾지 못했어요" 같은 에러가 납니다. 이때는 다시 시도해보거나,
> 화면을 직접 봐야 하는 경우 GUI가 있는 내 PC에서 한 번 로그인해 만든 `session.json`을
> 서버로 복사하는 방법도 있습니다.

## 그다음부터는 한 줄

```bash
npm run up          # → http://localhost:7777
```

## 사용법

1. 브라우저에서 `http://localhost:7777` 접속
2. 이모티콘샵 링크(`https://e.kakao.com/t/...`) 또는 공유키를 입력란에 붙여넣고 **추출**
3. 움직이는 이모티콘 / 정지 이미지를 각각 미리보고, 개별 저장하거나 **전체 ZIP**으로 받기

## 세션 만료 시

카카오 로그인 세션은 영구적이지 않습니다(수 주~수 개월 후 만료될 수 있습니다). 화면 상단의
상태 표시가 "정지 이미지만"으로 바뀌거나 `/api/status`가 `loggedIn: false`를 반환하면
세션이 만료된 것입니다. 이때는 다음을 실행하세요.

```bash
npm run login
npm run restart
```

정지 PNG는 세션 만료와 무관하게 항상 동작합니다.

## 운영 명령어 (pm2)

| 명령 | 설명 |
|---|---|
| `npm run up` | 서버 기동 + 부팅 목록 저장 |
| `npm run down` | 서버 종료 |
| `npm run restart` | 서버 재시작 (세션 갱신 후 등) |
| `npm run logs` | 실시간 로그 보기 |
| `npm run status` | pm2 프로세스 상태 확인 |

서버는 `autorestart: true`로 설정되어 있어 죽어도 자동으로 재시작됩니다.

부팅 시 자동 실행까지 원하면(선택):

```bash
npx pm2 startup     # 출력되는 명령을 1회 실행
npx pm2 save
```

## 구조

```
server.js            HTTP 서버 + 프론트 제공 + API
login.js             카카오 로그인 1회 실행 → session.json 생성
session.json          로그인 세션 (자동 생성, git에 커밋하지 않음)
ecosystem.config.js   pm2 실행 설정
public/               프론트엔드 (index.html, style.css, app.js)
```

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/` | 프론트 페이지 |
| GET | `/api/status` | `{ loggedIn: boolean }` |
| POST | `/api/extract` | body `{ input }` → `{ title, animated[], stills[], loggedIn }` |
| GET | `/download?url=` | 단일 이미지 다운로드 프록시 |
| POST | `/download-zip` | body `{ urls[], name }` → ZIP 스트리밍 |

다운로드 프록시는 `kakao.com` / `kakaocdn.net` / `daumcdn.net` 호스트만 허용합니다(SSRF 방지).

## 보안 / 개인정보

- 카카오 로그인 쿠키는 `e.kakao.com` API 호출에만 사용되고, CDN 다운로드에는 첨부되지 않습니다.
- `session.json`은 `.gitignore`에 포함되어 있어 커밋되지 않습니다. 이 파일에는 로그인 쿠키가
  들어있으니 외부에 공유하지 마세요.

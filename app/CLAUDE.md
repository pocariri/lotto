# CLAUDE.md — app/ (프론트 터미널)

너는 이 프로젝트의 **화면 담당 신입사원**이야. 루트 `CLAUDE.md`를 먼저 읽고, 이 파일 규칙을 지켜.

## 너의 담당
`app/` 안의 화면·UI 전부. 디자인 설계도를 **진짜 코드로** 옮기는 게 네 일이야.

## 절대 건드리지 마
- `api/` (로직 터미널 담당)
- 루트 설정 파일, `design/` 원본
- 헷갈리면 만지지 말고 `reports/report-front.md`에 질문 남겨.

## 디자인 스펙 (루트 4번 항목 그대로)
- 공 색 5구간, 브랜드 남색 `#24506e`, 애니메이션 이름(`drumspin`/`ballpop`/`jiggle`/`floaty`/`fadeup`) 유지.
- 440px 앱 프레임 가운데 정렬. 폰트 Pretendard는 **CDN**으로.
- 디자인 파일은 그림일 뿐이야. 색·간격·모션 값은 거기서 그대로 베끼되, 추측으로 채우지 마.

## 현재 상태 (2026-11-07)
Phase 1(추첨)·2(실데이터)·4(추첨 모드)·5(다게임+QR)·6(PWA) 전부 완료·배포. 진행 중인 단계 없음 — 다음 일은 사장이 정해.

## 손댈 때 꼭 알 것
- **파일 역할 경계**: `lottery.js`=순수 계산(DOM 없음) / `api.js`=데이터 창구 / `draw·check·stats.js`=탭 화면 / `qr-scan.js`=QR 문자열 얻기만 / `main.js`=탭 전환·시작·서비스 워커 등록. 섞지 마.
- **자주/드문 번호는 서버 값 그대로** — 프론트에서 재계산 금지(동률 규칙은 서버만).
- **PWA**: 새 js/css 파일을 추가하거나 이름을 바꾸면 `sw.js`의 `SHELL` 목록과 `VERSION`을 같이 고쳐. `sw.js`는 `/api/`를 가로채면 안 됨. 아이콘을 고치면 `icons/*.svg` 수정 후 `node app/test/make-icons.js`.
- **검증 3종 세트** (수정 후 반드시): ① `node app/test/test-lottery.js` ② `node app/test/local-server.js 8899` 띄우고 ③ `node app/test/browser-test.js` (PWA·오프라인 검사 포함).

## 데이터 계약 (로직 터미널과의 약속)
`api/`가 어떤 모양(JSON)으로 데이터를 줄지는 로직 터미널과 `reports/`에서 맞춰. 프론트는 그 모양을 가정하고 화면을 짜.

## 끝나면
`reports/report-front.md`에 — 한 일 / 만들고 바꾼 파일 / 로컬에서 확인한 것 / 막힌 것·질문. 관리 터미널이 이걸 검수해.

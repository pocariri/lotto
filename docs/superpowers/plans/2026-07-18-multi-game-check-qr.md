# 당첨확인 다게임(최대 5게임) + QR 스캔 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 당첨확인 탭에서 한 번에 최대 5게임을 게임별로 확인하고, 용지 QR을 카메라/사진으로 읽어 자동 입력·확인까지 되게 한다.

**Architecture:** 전부 프론트(`app/`)에서 처리한다. QR 문자열 해석은 순수 함수(`lottery.js`), 카메라/사진에서 문자열 얻기는 독립 모듈(`qr-scan.js` + vendored jsQR), 화면 상태는 `check.js`가 담당. 당첨번호는 기존 `/api/draw?round=N`을 그대로 재사용하며 `api/`는 무변경.

**Tech Stack:** 바닐라 JS(ES5 스타일, `window.Lotto` 네임스페이스), jsQR(vendored), CDP 기반 헤드리스 크롬 테스트(`app/test/browser-test.js`), 순수 로직 테스트(`app/test/test-lottery.js`).

**스펙:** `docs/superpowers/specs/2026-07-18-multi-game-check-qr-design.md` (사장 승인 2026-07-18)

## Global Constraints

- `api/` 폴더는 어떤 파일도 수정 금지 (스펙 6절: "api/ **무변경**").
- `app/js/*.js`는 기존 스타일 유지: `var`/`function`, `window.Lotto` 네임스페이스, IIFE 모듈, 한국어 주석.
- 화면 문구는 스펙의 문자열 그대로 (5절 에러 처리 표): "로또 용지의 QR 코드를 찾지 못했어요." / "이 용지는 ○○○○회예요. 토요일 추첨 후에 확인해 주세요." / "○게임이 6개가 안 됐어요. 다 채우거나 지워주세요." / "번호를 입력하거나 QR을 스캔해 주세요."
- 게임 라벨은 A~E, 최대 5게임 (스펙 3-1절).
- 새 애니메이션 추가 금지 — 결과 카드는 기존 `fadeup` 재사용, `prefers-reduced-motion` 존중 (스펙 7절).
- 유료 API·외부 전송 금지. QR 해독은 전부 브라우저 안에서 (스펙 7절).
- 테스트 실행은 항상 저장소 루트에서: `node app/test/test-lottery.js` 등.
- 커밋 메시지는 한국어 한 줄 + 아래 푸터:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

| 파일 | 역할 |
|---|---|
| `app/js/lottery.js` (수정) | `parseTicketQr(text)` 순수 함수 + `MAX_GAMES` 상수 추가. DOM 모름 |
| `app/js/vendor/jsqr.min.js` (신규, vendored) | QR 이미지 해독 라이브러리. 전역 `jsQR(data, w, h)` 제공 |
| `app/js/qr-scan.js` (신규) | 카메라 오버레이 + 사진 파일 → QR **문자열 하나** 얻기. 해석·화면 상태 모름 |
| `app/js/check.js` (전면 개편) | 다게임 상태(`games[][]`), 게임 추가/삭제, 게임별 결과, QR 결과 반영 |
| `app/index.html` (수정) | 게임 목록/추가 버튼/QR 버튼/게임별 결과/오버레이 마크업 + script 태그 2개 |
| `app/css/check.css` (수정) | 게임 줄·삭제 버튼·게임별 결과·오버레이 스타일 |
| `app/css/components.css` (수정) | `.ball--28` 크기 추가 |
| `app/test/test-lottery.js` (수정) | QR 파싱 테스트 추가 |
| `app/test/browser-test.js` (수정) | 다게임·QR(사진 경로) 시나리오 추가, 기존 당첨확인 단언 갱신 |
| `app/test/vendor/qrcode-generator.js` (신규, 테스트 전용) | QR 이미지 픽스처 생성용 (배포 제외 — `.vercelignore`가 `app/test` 제외) |
| `app/test/qr-fixture.js` (신규, 테스트 전용) | 문자열 → QR BMP 버퍼 (의존성 없음) |

---

### Task 1: `parseTicketQr` 순수 로직 (TDD)

**Files:**
- Modify: `app/js/lottery.js` (134행 `rank` 뒤에 추가)
- Test: `app/test/test-lottery.js` (파일 끝 `console.log` 요약 앞에 추가)

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces: `Lotto.logic.parseTicketQr(text: string) → { round: number, games: number[][] } | null` (games는 각각 오름차순 6개, 최대 5게임), `Lotto.logic.MAX_GAMES = 5`

- [ ] **Step 1: 실패하는 테스트 작성**

`app/test/test-lottery.js`의 마지막 `console.log(failures === 0 ...)` 줄 **앞**에 추가:

```js
// ---- 당첨확인 확장: 용지 QR 파싱 (스펙 2026-07-18 4절) ----
// parseTicketQr(text) → { round, games[][6] } | null
// 실제 용지 QR 예: https://m.dhlottery.co.kr/qr.do?method=winQr&v=1107m061430314041

// 18) 1게임 (실제 용지 형식)
tryBlock('QR 1게임', () => {
  const p = L.parseTicketQr('https://m.dhlottery.co.kr/qr.do?method=winQr&v=1107m061430314041');
  assert('QR 1게임: 회차 1107', p && p.round === 1107);
  assert('QR 1게임: 번호', p && JSON.stringify(p.games) === JSON.stringify([[6, 14, 30, 31, 40, 41]]));
});

// 19) 5게임 + 게임마다 다른 구분 글자(m/q 혼용) + 신형 주소
tryBlock('QR 5게임', () => {
  const v5 = '0843m010203040506q111213141516m212223242526q313233343536m404142434445';
  const p = L.parseTicketQr('http://qr.dhlottery.co.kr/?v=' + v5);
  assert('QR 5게임: 회차 843', p && p.round === 843);
  assert('QR 5게임: 5개', p && p.games.length === 5);
  assert('QR 5게임: 마지막 게임', p && JSON.stringify(p.games[4]) === JSON.stringify([40, 41, 42, 43, 44, 45]));
});

// 20) 마지막 게임 뒤에 일련번호 꼬리가 붙어도 무시 (인쇄 변형 대비)
tryBlock('QR 꼬리 무시', () => {
  const p = L.parseTicketQr('https://m.dhlottery.co.kr/qr.do?method=winQr&v=1200q0102030405061234567890');
  assert('QR 꼬리: 1게임만', p && p.games.length === 1 && JSON.stringify(p.games[0]) === JSON.stringify([1, 2, 3, 4, 5, 6]));
});

// 21) 번호가 뒤섞여 있어도 오름차순으로 정렬해서 돌려준다
tryBlock('QR 정렬', () => {
  const p = L.parseTicketQr('x?v=1200q060504030201');
  assert('QR 정렬: 오름차순', p && JSON.stringify(p.games[0]) === JSON.stringify([1, 2, 3, 4, 5, 6]));
});

// 22) 불량 입력은 전부 null 또는 걸러냄
tryBlock('QR 불량 입력', () => {
  assert('QR 불량: 로또 아님', L.parseTicketQr('https://example.com/hello') === null);
  assert('QR 불량: 빈 문자열', L.parseTicketQr('') === null);
  assert('QR 불량: 문자열 아님', L.parseTicketQr(null) === null);
  assert('QR 불량: 범위 밖(00)', L.parseTicketQr('x?v=1200q000000000000') === null);
  assert('QR 불량: 범위 밖(46)', L.parseTicketQr('x?v=1200q464646464646') === null);
  assert('QR 불량: 중복 번호', L.parseTicketQr('x?v=1200q010101010101') === null);
  assert('QR 불량: 회차 없음', L.parseTicketQr('x?v=q010203040506') === null);
});

// 23) 유효/불량 섞이면 유효한 게임만, 6게임 이상이면 앞의 5게임만
tryBlock('QR 부분 채택', () => {
  const mix = L.parseTicketQr('x?v=1200q000000000000q111213141516');
  assert('QR 부분: 유효 게임만', mix && mix.games.length === 1 && mix.games[0][0] === 11);
  const six = L.parseTicketQr('x?v=1200' + 'q010203040506'.repeat(6));
  assert('QR 부분: 최대 5게임', six && six.games.length === 5);
  assert('MAX_GAMES 상수', L.MAX_GAMES === 5);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node app/test/test-lottery.js`
Expected: `FAIL` 다수 — `QR 1게임 (예외: L.parseTicketQr is not a function)` 류. 기존 1~17번은 전부 PASS 유지.

- [ ] **Step 3: 구현**

`app/js/lottery.js`의 `rank(matches, bonusHit) {...}` 메서드 **앞**(`// 맞은 개수...` 주석 위)에 추가:

```js
  // ---- 당첨확인 다게임/QR (스펙 2026-07-18) ----

  MAX_GAMES: 5, // 용지 한 장의 최대 게임 수 (A~E)

  // 용지 QR 주소 → { round, games[][6] } | null.
  // 형식: ...?v=<회차숫자>(<영문자><숫자12자리>)반복<꼬리 무시>
  //   예) ...?v=1107m061430314041  → 1107회, [6,14,30,31,40,41]
  // 게임별 검증(1~45, 중복 없음)을 통과한 게임만 채택하고 오름차순 정렬.
  // 끝에 붙는 일련번호 등 꼬리는 무시한다(인쇄 시기별 변형 대비).
  parseTicketQr(text) {
    if (typeof text !== 'string') return null;
    var m = text.match(/(?:^|[?&])v=([0-9A-Za-z]+)/);
    if (!m) return null;
    var v = m[1];
    var head = v.match(/^\d{1,4}/);
    if (!head) return null;
    var round = parseInt(head[0], 10);
    if (!(round >= 1)) return null;

    var self = this;
    var games = [];
    var re = /[A-Za-z](\d{12})/g;
    var g;
    while ((g = re.exec(v)) !== null && games.length < this.MAX_GAMES) {
      var nums = [];
      for (var i = 0; i < 12; i += 2) nums.push(parseInt(g[1].slice(i, i + 2), 10));
      var okRange = nums.every(function (n) { return n >= self.MIN && n <= self.MAX; });
      if (okRange && new Set(nums).size === this.PICK) {
        games.push(nums.slice().sort(function (a, b) { return a - b; }));
      }
    }
    if (!games.length) return null;
    return { round: round, games: games };
  },
```

- [ ] **Step 4: 통과 확인**

Run: `node app/test/test-lottery.js`
Expected: 마지막 줄 `== 전부 통과 ==`, exit 0. (기존 1~17번 포함 전부 PASS)

- [ ] **Step 5: 커밋**

```bash
git add app/js/lottery.js app/test/test-lottery.js
git commit -m "$(cat <<'EOF'
당첨확인 확장 1/5: 용지 QR 파싱 순수 로직(parseTicketQr) + 테스트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: jsQR vendored 파일 + script 태그

**Files:**
- Create: `app/js/vendor/jsqr.min.js` (다운로드)
- Modify: `app/index.html:186` (script 태그 블록)

**Interfaces:**
- Consumes: 없음
- Produces: 브라우저 전역 `jsQR(data: Uint8ClampedArray, width: number, height: number) → { data: string } | null` (Task 4의 `qr-scan.js`가 사용)

- [ ] **Step 1: 다운로드 및 머리말 주석**

```bash
mkdir -p app/js/vendor
curl -sL -o /tmp/jsqr-dl.js https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js
printf '/* jsQR v1.4.0 — https://github.com/cozmo/jsQR (Apache-2.0)\n   jsDelivr 축소본을 vendored — QR 이미지 해독. 전역 jsQR(data,w,h)를 제공한다. */\n' > app/js/vendor/jsqr.min.js
cat /tmp/jsqr-dl.js >> app/js/vendor/jsqr.min.js
```

참고: 위 URL이 404면 비축소본 `https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js`를 받아도 된다(동작 동일, 크기만 큼). 주석의 버전·라이선스는 유지.

- [ ] **Step 2: 로드 검증 (node에서 UMD 확인)**

Run: `node -e "const f = require('./app/js/vendor/jsqr.min.js'); console.log(typeof f)"`
Expected: `function`

Run: `ls -la app/js/vendor/jsqr.min.js`
Expected: 30KB 이상 (내용이 빈 파일/에러 페이지가 아닌지 확인)

- [ ] **Step 3: script 태그 추가**

`app/index.html`의 `<script src="js/lottery.js" defer></script>` 줄 **바로 위**에:

```html
<script src="js/vendor/jsqr.min.js" defer></script>
```

- [ ] **Step 4: 브라우저 전역 확인**

```bash
node app/test/local-server.js 8899 &
sleep 1
curl -s http://localhost:8899/js/vendor/jsqr.min.js | head -c 200
kill %1
```
Expected: 첫 줄에 `/* jsQR v1.4.0` 머리말이 보인다 (서버가 파일을 서빙함).

- [ ] **Step 5: 커밋**

```bash
git add app/js/vendor/jsqr.min.js app/index.html
git commit -m "$(cat <<'EOF'
당첨확인 확장 2/5: jsQR 라이브러리 vendored + 로드 태그

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 당첨확인 다게임 개편 (입력 + 게임별 결과)

**Files:**
- Modify: `app/index.html:108-134` (당첨확인 섹션)
- Modify: `app/js/check.js` (전면 재작성 — 아래 전체 코드)
- Modify: `app/css/check.css`
- Modify: `app/css/components.css:24` (`.ball--38` 아래에 `.ball--28`)
- Test: `app/test/browser-test.js:153-189` (당첨확인 구간 갱신 + 다게임 시나리오 추가)

**Interfaces:**
- Consumes: Task 1의 `Lotto.logic.parseTicketQr`, `Lotto.logic.MAX_GAMES`, 기존 `Lotto.logic.rank/ballClass`, `Lotto.api.getDraw(round?)`
- Produces:
  - DOM id: `games-list`, `add-game-btn`, `qr-scan-btn`, `result-summary`, `game-results` (+ 기존 id 유지: `round-chips`, `pad-grid`, `run-check-btn`, `check-notice`, `check-result`, `check-round-label`, `win-row`, `prize-text`)
  - CSS 클래스: `.game-row`(+`.is-active`), `.game-label`, `.game-del`, `.add-game-btn`, `.game-result-row`, `.game-result-rank`(+`.is-win`), `.result-summary`(+`.is-win`), `.ball--28`, `.ball--miss`
  - `check.js` 내부 `onQrText(text)` — QR 문자열을 받아 게임/회차 반영 + 자동 결과. `qr-scan-btn` 클릭 리스너는 `Lotto.qrscan`이 있으면 `Lotto.qrscan.open(onQrText)` 호출(가드 포함 — Task 4 전엔 아무 일 안 함)
  - 제거되는 DOM id: `entry-row`(단일), `rank-box`, `match-text`, `rank-text` — browser-test의 기존 단언도 이번 태스크에서 함께 갱신

- [ ] **Step 1: 실패하는 브라우저 테스트로 갱신**

`app/test/browser-test.js`에서 당첨확인 구간을 다음과 같이 바꾼다.

(a) 163~165행(빈 입력 안내)을 교체:

```js
  // 빈 입력 안내 (다게임 문구)
  await evaluate(`document.getElementById('run-check-btn').click()`);
  const emptyNotice = await evaluate(`!document.getElementById('check-notice').hidden && document.getElementById('check-notice').textContent`);
  assert('빈 입력 안내 문구', /번호를 입력하거나 QR을 스캔해 주세요/.test(emptyNotice || ''), emptyNotice);
```

(b) 167~189행(1등 시나리오 + 스크린샷)을 통째로 교체:

```js
  // 이전 회차 chip 선택 → A게임에 그 회차 당첨번호 6개 → 1등
  await evaluate(`document.getElementById('round-chips').children[1].click()`);
  assert('회차 데이터 로딩 완료', await waitFor(`document.getElementById('check-status').hidden`));
  await evaluate(`(function(){
    var pad = document.getElementById('pad-grid');
    ${JSON.stringify(prevRound.numbers)}.forEach(function(n){ pad.children[n-1].click(); });
  })()`);
  await evaluate(`document.getElementById('run-check-btn').click()`);
  await sleep(300);
  const checkResult = await evaluate(`(function(){
    var rows = document.querySelectorAll('#game-results .game-result-row');
    return {
      round: document.getElementById('check-round-label').textContent,
      rows: rows.length,
      rankA: rows[0] ? rows[0].querySelector('.game-result-rank').textContent : '',
      summary: document.getElementById('result-summary').textContent,
      prize: document.getElementById('prize-text').textContent,
      shown: !document.getElementById('check-result').hidden };
  })()`);
  assert('당첨번호 6개 입력 → A게임 1등',
    checkResult.shown && checkResult.rows === 1 &&
    /1등/.test(checkResult.rankA) && /6개 일치/.test(checkResult.rankA) &&
    checkResult.round === prevRound.round + '회 당첨번호', JSON.stringify(checkResult));
  assert('요약 줄: 1게임 중 1등 1개', /1게임 중 1등 1개/.test(checkResult.summary), checkResult.summary);
  const expectPrize = prevRound.firstPrize.winners > 0
    ? '이 회차 1등: ' + prevRound.firstPrize.winners + '명 · 1인당 ' + prevRound.firstPrize.amountPerWinner.toLocaleString('ko-KR') + '원'
    : '이 회차는 1등 당첨자 없음';
  assert('1등 당첨금 표시', checkResult.prize === expectPrize, checkResult.prize + ' vs ' + expectPrize);
  await shot('04-check-result.png');

  // ---- 다게임: B게임 추가 → 반쯤 채움 안내 → 다 채우면 게임별 결과 ----
  const winSetPrev = new Set(prevRound.numbers.concat([prevRound.bonus]));
  const losing = [];
  for (let n = 1; n <= 45 && losing.length < 6; n++) if (!winSetPrev.has(n)) losing.push(n);

  await evaluate(`document.getElementById('add-game-btn').click()`);
  assert('게임 추가 → 2줄', await evaluate(`document.querySelectorAll('#games-list .game-row').length`) === 2);
  // 방금 추가된 B게임이 활성 — 3개만 넣고 확인 → 안내
  await evaluate(`(function(){
    var pad = document.getElementById('pad-grid');
    ${JSON.stringify(losing.slice(0, 3))}.forEach(function(n){ pad.children[n-1].click(); });
  })()`);
  await evaluate(`document.getElementById('run-check-btn').click()`);
  const halfNotice = await evaluate(`!document.getElementById('check-notice').hidden && document.getElementById('check-notice').textContent`);
  assert('반쯤 채운 게임 안내', /B게임이 6개가 안 됐어요/.test(halfNotice || ''), halfNotice);
  // 나머지 3개 채우고 확인 → 게임별 결과 2줄 (A=1등, B=낙첨)
  await evaluate(`(function(){
    var pad = document.getElementById('pad-grid');
    ${JSON.stringify(losing.slice(3))}.forEach(function(n){ pad.children[n-1].click(); });
  })()`);
  await evaluate(`document.getElementById('run-check-btn').click()`);
  await sleep(300);
  const multi = await evaluate(`(function(){
    var rows = document.querySelectorAll('#game-results .game-result-row');
    return { rows: rows.length,
      rankA: rows[0] ? rows[0].querySelector('.game-result-rank').textContent : '',
      rankB: rows[1] ? rows[1].querySelector('.game-result-rank').textContent : '',
      summary: document.getElementById('result-summary').textContent };
  })()`);
  assert('다게임 결과: A=1등, B=낙첨',
    multi.rows === 2 && /1등/.test(multi.rankA) && /낙첨/.test(multi.rankB), JSON.stringify(multi));
  assert('다게임 요약: 2게임 중 1등 1개', /2게임 중 1등 1개/.test(multi.summary), multi.summary);
  await shot('08-check-multi.png');

  // ---- 게임 추가 한도(5)와 삭제 ----
  await evaluate(`document.getElementById('add-game-btn').click()`); // 3
  await evaluate(`document.getElementById('add-game-btn').click()`); // 4
  await evaluate(`document.getElementById('add-game-btn').click()`); // 5
  assert('5게임이면 추가 버튼 비활성', await evaluate(`document.getElementById('add-game-btn').disabled`) === true);
  for (let i = 0; i < 3; i++) {
    await evaluate(`(function(){
      var rows = document.querySelectorAll('#games-list .game-row');
      rows[rows.length - 1].querySelector('.game-del').click();
    })()`);
  }
  assert('마지막 줄 3개 삭제 → 2줄', await evaluate(`document.querySelectorAll('#games-list .game-row').length`) === 2);
  assert('삭제 후 추가 버튼 다시 활성', await evaluate(`document.getElementById('add-game-btn').disabled`) === false);
```

- [ ] **Step 2: 실패 확인**

```bash
node app/test/local-server.js 8899 &
sleep 1
node app/test/browser-test.js
kill %1
```
Expected: 당첨확인 구간 FAIL 다수 (`#game-results` 없음, `add-game-btn` 없음 등). 추첨 탭 구간은 PASS 유지.

- [ ] **Step 3: `app/index.html` 당첨확인 섹션 교체**

109~134행 `<section id="tab-check" ...>` 내부를 다음으로 교체 (섹션 태그 자체는 유지):

```html
        <h2 class="screen-title">당첨 확인</h2>
        <p class="screen-sub">회차를 고르고 게임별 번호 6개를 입력하세요</p>
        <p class="status-note" id="check-status" role="status">당첨 정보를 불러오는 중…</p>
        <div id="check-content" hidden>
        <div class="round-chips" id="round-chips"></div>
        <button type="button" id="qr-scan-btn" class="btn-outline btn-outline--qr">용지 QR로 확인</button>
        <div class="card entry-card">
          <p class="label">내 번호</p>
          <div id="games-list"></div>
          <button type="button" id="add-game-btn" class="add-game-btn">＋ 게임 추가 (1/5)</button>
        </div>
        <div class="card pad-card">
          <div class="pad-grid" id="pad-grid"></div>
        </div>
        <button type="button" id="run-check-btn" class="btn-primary btn-primary--check">결과 확인</button>
        <p class="check-notice" id="check-notice" role="alert" hidden></p>
        <div class="check-result" id="check-result" hidden>
          <p class="sub" id="check-round-label"></p>
          <div class="win-row" id="win-row"></div>
          <p class="result-summary" id="result-summary"></p>
          <div class="game-results" id="game-results"></div>
          <p class="prize-line" id="prize-text"></p>
        </div>
        </div><!-- /check-content -->
```

- [ ] **Step 4: `app/js/check.js` 전면 재작성**

파일 전체를 다음으로 교체:

```js
// check.js — 당첨 확인 탭. 회차를 고르고 게임(최대 5개, A~E)별 번호 6개를 넣으면 게임별 등수를 알려준다.
// 데이터는 Lotto.api(계약 v1.2). QR 스캔(Lotto.qrscan)으로 회차+게임 자동 입력도 지원.
// 스펙: docs/superpowers/specs/2026-07-18-multi-game-check-qr-design.md

window.Lotto = window.Lotto || {};

Lotto.check = (function () {
  var LABELS = ['A', 'B', 'C', 'D', 'E'];

  var state = {
    chipRounds: [],       // 기본 chip 회차 (최신부터 최대 5개)
    qrRound: null,        // QR로 들어온 회차가 chip에 없으면 맨 앞에 임시 chip (새 스캔 시 교체)
    round: null,          // 지금 고른 회차 번호
    current: null,        // 고른 회차의 데이터 (로딩 중이거나 실패하면 null)
    loading: false,
    games: [emptyGame()], // games[g][slot] = 번호 | null
    activeGame: 0,
    activeSlot: 0,
    results: null         // [{ label, nums[6], matches, bonusHit, rank }] 또는 null
  };

  var el = {};

  function emptyGame() { return [null, null, null, null, null, null]; }

  async function init() {
    el.status = document.getElementById('check-status');
    el.content = document.getElementById('check-content');
    el.chips = document.getElementById('round-chips');
    el.gamesList = document.getElementById('games-list');
    el.addGame = document.getElementById('add-game-btn');
    el.padGrid = document.getElementById('pad-grid');
    el.notice = document.getElementById('check-notice');
    el.result = document.getElementById('check-result');
    el.roundLabel = document.getElementById('check-round-label');
    el.winRow = document.getElementById('win-row');
    el.summary = document.getElementById('result-summary');
    el.gameResults = document.getElementById('game-results');
    el.prizeText = document.getElementById('prize-text');

    buildPad();
    el.addGame.addEventListener('click', addGame);
    document.getElementById('run-check-btn').addEventListener('click', function () { runCheck(); });
    document.getElementById('qr-scan-btn').addEventListener('click', function () {
      // qr-scan.js가 로드 실패해도 앱이 죽지 않게 가드
      if (Lotto.qrscan) Lotto.qrscan.open(onQrText);
    });

    try {
      var latest = await Lotto.api.getDraw();
      state.chipRounds = [];
      for (var i = 0; i < 5; i++) {
        var r = latest.round - i;
        if (r >= 1) state.chipRounds.push(r);
      }
      state.round = latest.round;
      state.current = latest;
      el.status.hidden = true;
      el.content.hidden = false;
      render();
    } catch (e) {
      showStatus(e.message, true);
    }
  }

  // ---- 화면 부품 만들기 (한 번만) ----

  function buildPad() {
    for (var n = 1; n <= 45; n++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pad-cell';
      b.textContent = n;
      b.addEventListener('click', padClick(n));
      el.padGrid.appendChild(b);
    }
  }
  function padClick(n) {
    return function () { padPick(n); };
  }

  // ---- 상태 문구 ----

  function showStatus(msg, isError) {
    el.status.textContent = msg;
    el.status.classList.toggle('status-note--error', !!isError);
    el.status.hidden = false;
  }

  function notice(msg) {
    el.notice.textContent = msg;
    el.notice.hidden = false;
  }

  // ---- 동작 ----

  async function setRound(round) {
    if (round === state.round && state.current) { render(); return; }
    state.round = round;
    state.results = null;
    state.current = null;
    state.loading = true;
    el.notice.hidden = true;
    render();
    showStatus(round + '회 정보를 불러오는 중…');
    try {
      var data = await Lotto.api.getDraw(round);
      if (state.round !== round) return; // 기다리는 동안 다른 회차를 골랐으면 무시
      state.current = data;
      state.loading = false;
      el.status.hidden = true;
    } catch (e) {
      if (state.round !== round) return;
      state.loading = false;
      showStatus(e.message, true);
    }
    render();
  }

  // 패드에서 번호를 누르면: 활성 게임에 이미 있으면 빼고, 없으면 활성 칸(또는 빈 칸)에 넣는다.
  // 다른 게임과 같은 번호여도 상관없다 — 게임끼리는 독립.
  function padPick(n) {
    el.notice.hidden = true;
    var game = state.games[state.activeGame].slice();
    var already = game.indexOf(n);
    if (already !== -1) {
      game[already] = null;
      state.games[state.activeGame] = game;
      state.results = null;
      render();
      return;
    }
    var i = state.activeSlot;
    if (game[i] != null) {
      var empty = game.indexOf(null);
      if (empty === -1) return; // 이 게임 6칸 다 참
      i = empty;
    }
    game[i] = n;
    var next = game.indexOf(null);
    state.games[state.activeGame] = game;
    state.activeSlot = next === -1 ? i : next;
    state.results = null;
    render();
  }

  function firstEmpty(game) {
    var i = game.indexOf(null);
    return i === -1 ? 0 : i;
  }

  function selectGame(g, s) {
    state.activeGame = g;
    state.activeSlot = s != null ? s : firstEmpty(state.games[g]);
    render();
  }

  function addGame() {
    if (state.games.length >= Lotto.logic.MAX_GAMES) return;
    state.games.push(emptyGame());
    state.activeGame = state.games.length - 1;
    state.activeSlot = 0;
    state.results = null;
    el.notice.hidden = true;
    render();
  }

  function removeGame(g) {
    if (g === 0) return; // A게임은 삭제 불가 (비우기만)
    state.games.splice(g, 1);
    if (state.activeGame >= state.games.length) state.activeGame = state.games.length - 1;
    state.activeSlot = firstEmpty(state.games[state.activeGame]);
    state.results = null;
    render();
  }

  function runCheck() {
    if (state.loading) {
      notice('회차 정보를 불러오는 중이에요. 잠깐만 기다려주세요.');
      return;
    }
    if (!state.current) {
      notice('회차 정보를 못 불러왔어요. 회차를 다시 골라주세요.');
      return;
    }
    var filled = [];
    for (var g = 0; g < state.games.length; g++) {
      var nums = state.games[g].filter(function (x) { return x != null; });
      if (nums.length === 0) continue; // 완전히 빈 게임 줄은 무시 (스펙 3-2)
      if (nums.length < 6) {
        notice(LABELS[g] + '게임이 6개가 안 됐어요. 다 채우거나 지워주세요.');
        return;
      }
      filled.push({ label: LABELS[g], nums: nums });
    }
    if (!filled.length) {
      notice('번호를 입력하거나 QR을 스캔해 주세요.');
      return;
    }
    el.notice.hidden = true;
    var r = state.current;
    var winSet = new Set(r.numbers);
    state.results = filled.map(function (f) {
      var matches = f.nums.filter(function (n) { return winSet.has(n); }).length;
      var bonusHit = f.nums.indexOf(r.bonus) !== -1;
      return {
        label: f.label, nums: f.nums, matches: matches, bonusHit: bonusHit,
        rank: Lotto.logic.rank(matches, bonusHit)
      };
    });
    render();
  }

  // QR 문자열 처리 — qr-scan.js가 인식에 성공하면 이리로 온다 (스펙 3-4)
  function onQrText(text) {
    var parsed = Lotto.logic.parseTicketQr(text);
    if (!parsed) {
      notice('로또 용지의 QR 코드를 찾지 못했어요.');
      return;
    }
    var latest = state.chipRounds[0];
    if (latest && parsed.round > latest) {
      notice('이 용지는 ' + parsed.round + '회예요. 토요일 추첨 후에 확인해 주세요.');
      return;
    }
    state.games = parsed.games.map(function (g) { return g.slice(); });
    state.activeGame = 0;
    state.activeSlot = 0;
    state.results = null;
    el.notice.hidden = true;
    // chip에 없는 회차면 임시 chip으로 (새 스캔 시 교체)
    state.qrRound = state.chipRounds.indexOf(parsed.round) === -1 ? parsed.round : null;
    if (parsed.round === state.round && state.current) {
      runCheck();
      return;
    }
    setRound(parsed.round).then(function () {
      if (state.round === parsed.round && state.current) runCheck();
    });
  }

  // 요약 한 줄: "2게임 중 1등 1개 · 5등 1개" / "아쉽지만 모두 낙첨이에요"
  function summaryText(results) {
    var order = ['1등', '2등', '3등', '4등', '5등'];
    var counts = {};
    results.forEach(function (x) { counts[x.rank] = (counts[x.rank] || 0) + 1; });
    var parts = order.filter(function (k) { return counts[k]; })
      .map(function (k) { return k + ' ' + counts[k] + '개'; });
    if (!parts.length) return '아쉽지만 모두 낙첨이에요';
    return results.length + '게임 중 ' + parts.join(' · ');
  }

  // ---- 그리기 ----

  function render() {
    renderChips();
    renderGames();
    renderPad();
    renderResult();
  }

  function renderChips() {
    el.chips.innerHTML = '';
    var rounds = state.chipRounds.slice();
    if (state.qrRound != null && rounds.indexOf(state.qrRound) === -1) rounds.unshift(state.qrRound);
    rounds.forEach(function (round) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (round === state.round ? ' is-active' : '');
      b.textContent = round + '회';
      b.addEventListener('click', function () { setRound(round); });
      el.chips.appendChild(b);
    });
  }

  function renderGames() {
    el.gamesList.innerHTML = '';
    state.games.forEach(function (game, g) {
      var row = document.createElement('div');
      row.className = 'game-row' + (g === state.activeGame ? ' is-active' : '');

      var label = document.createElement('span');
      label.className = 'game-label';
      label.textContent = LABELS[g];
      row.appendChild(label);

      var slots = document.createElement('div');
      slots.className = 'entry-row';
      game.forEach(function (n, s) {
        var b = document.createElement('button');
        b.type = 'button';
        if (n != null) {
          b.className = 'entry-ball ball ball--38 ' + Lotto.logic.ballClass(n);
          b.textContent = n;
        } else {
          b.className = 'slot' + (g === state.activeGame && s === state.activeSlot ? ' is-active' : '');
        }
        b.setAttribute('aria-label', LABELS[g] + '게임 ' + (s + 1) + '번째 번호 칸');
        b.addEventListener('click', function () { selectGame(g, s); });
        slots.appendChild(b);
      });
      row.appendChild(slots);

      if (g > 0) {
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'game-del';
        del.textContent = '×';
        del.setAttribute('aria-label', LABELS[g] + '게임 삭제');
        del.addEventListener('click', function () { removeGame(g); });
        row.appendChild(del);
      }
      el.gamesList.appendChild(row);
    });

    el.addGame.textContent = '＋ 게임 추가 (' + state.games.length + '/' + Lotto.logic.MAX_GAMES + ')';
    el.addGame.disabled = state.games.length >= Lotto.logic.MAX_GAMES;
  }

  function renderPad() {
    var game = state.games[state.activeGame];
    var cells = el.padGrid.children;
    for (var c = 0; c < cells.length; c++) {
      var num = c + 1;
      var sel = game.indexOf(num) !== -1;
      cells[c].className = 'pad-cell' + (sel ? ' is-selected ' + Lotto.logic.ballClass(num) : '');
    }
  }

  function renderResult() {
    var wasHidden = el.result.hidden;
    if (state.results && state.current) {
      var r = state.current;
      el.roundLabel.textContent = r.round + '회 당첨번호';
      el.winRow.innerHTML = '';
      r.numbers.forEach(function (n) { el.winRow.appendChild(makeBall(n, 'ball--38')); });
      var plus = document.createElement('span');
      plus.className = 'plus';
      plus.textContent = '+';
      el.winRow.appendChild(plus);
      el.winRow.appendChild(makeBall(r.bonus, 'ball--38'));

      var anyWin = state.results.some(function (x) { return x.rank !== '낙첨'; });
      el.summary.textContent = summaryText(state.results);
      el.summary.classList.toggle('is-win', anyWin);

      var winSet = new Set(r.numbers);
      el.gameResults.innerHTML = '';
      state.results.forEach(function (res) {
        var row = document.createElement('div');
        row.className = 'game-result-row';

        var label = document.createElement('span');
        label.className = 'game-label';
        label.textContent = res.label;
        row.appendChild(label);

        var balls = document.createElement('div');
        balls.className = 'balls';
        res.nums.forEach(function (n) {
          var b = makeBall(n, 'ball--28');
          // 맞은 번호(보너스 포함)는 그대로, 못 맞춘 번호는 흐리게 (스펙 3-3)
          if (!winSet.has(n) && n !== r.bonus) b.classList.add('ball--miss');
          balls.appendChild(b);
        });
        row.appendChild(balls);

        var rk = document.createElement('div');
        rk.className = 'game-result-rank' + (res.rank !== '낙첨' ? ' is-win' : '');
        var strong = document.createElement('b');
        strong.textContent = res.rank;
        var small = document.createElement('span');
        small.textContent = res.matches + '개 일치' + (res.bonusHit ? ' + 보너스' : '');
        rk.appendChild(strong);
        rk.appendChild(small);
        row.appendChild(rk);

        el.gameResults.appendChild(row);
      });

      // 1등 당첨금 (계약 v1.2 firstPrize) — winners가 0인 회차가 실제로 있다
      var fp = r.firstPrize;
      if (fp && fp.winners > 0) {
        el.prizeText.textContent =
          '이 회차 1등: ' + fp.winners + '명 · 1인당 ' + fp.amountPerWinner.toLocaleString('ko-KR') + '원';
      } else {
        el.prizeText.textContent = '이 회차는 1등 당첨자 없음';
      }

      el.result.hidden = false;
      // 결과가 새로 나타났을 때만 화면을 결과 위치로 내려준다
      if (wasHidden) el.result.scrollIntoView({ block: 'nearest' });
    } else {
      el.result.hidden = true;
    }
  }

  function makeBall(n, size) {
    var d = document.createElement('div');
    d.className = 'ball ' + size + ' ' + Lotto.logic.ballClass(n);
    d.textContent = n;
    return d;
  }

  return { init: init };
})();
```

- [ ] **Step 5: CSS**

(a) `app/css/components.css`의 `.ball--38` 줄 아래에 추가:

```css
.ball--28 { width: 28px; height: 28px; font-size: 12px; }
```

(b) `app/css/check.css`에서 `/* 내 번호 카드 */` 블록(10~21행)을 다음으로 교체:

```css
/* 내 번호 카드 — 게임(A~E) 줄 목록 */
.entry-card { padding: 18px 16px; margin-bottom: 14px; }
.entry-card .label { margin: 0 0 12px; font-size: 12px; font-weight: 700; color: var(--muted); }

.game-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; margin-bottom: 8px;
  border-radius: 14px; border: 1.5px solid transparent;
}
.game-row.is-active { border-color: var(--brand); background: #eef3f7; }
.game-label { flex: 0 0 16px; font-size: 13px; font-weight: 800; color: var(--muted); text-align: center; }
.entry-row { display: flex; gap: 6px; }

/* 빈 칸 / 선택 중인 칸 / 채워진 칸 */
.slot {
  width: 38px; height: 38px; border-radius: 50%; cursor: pointer;
  border: 2px dashed #cfc8bd; background: #f5f2ec;
}
.slot.is-active { border: 2px solid var(--brand); background: #fff; }
/* 채워진 칸: .slot 배경이 공 색을 덮지 않도록 별도 클래스로 */
.entry-ball { border: none; padding: 0; cursor: pointer; }

.game-del {
  flex: 0 0 auto; width: 26px; height: 26px; margin-left: auto;
  border: none; border-radius: 50%; cursor: pointer;
  background: #f0ede7; color: var(--muted); font-size: 15px; font-weight: 800; line-height: 1;
}

.add-game-btn {
  display: block; width: 100%; padding: 11px; margin-top: 2px;
  border: 1.5px dashed #cfc8bd; border-radius: 12px;
  background: transparent; color: var(--muted); font-size: 13px; font-weight: 700; cursor: pointer;
}
.add-game-btn:disabled { opacity: .45; cursor: default; }

/* QR 버튼 (회차 칩 아래) */
.btn-outline--qr { width: 100%; padding: 13px; margin-bottom: 14px; background: #fff; color: var(--ink); font-size: 14px; }
```

(c) `app/css/check.css`에서 `/* 결과 카드 */` 아래의 `.rank-box` 관련 블록(54~58행)을 다음으로 교체:

```css
/* 요약 한 줄 + 게임별 결과 */
.result-summary { margin: 0 0 6px; text-align: center; font-size: 15px; font-weight: 800; color: var(--muted); }
.result-summary.is-win { color: var(--brand); }

.game-result-row { display: flex; align-items: center; gap: 6px; padding: 10px 0; border-top: 1px solid #f0ede7; }
.game-result-row .balls { display: flex; gap: 4px; }
.ball--miss { opacity: .28; }
.game-result-rank { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; }
.game-result-rank b { font-size: 15px; font-weight: 800; color: var(--muted); }
.game-result-rank.is-win b { color: var(--brand); }
.game-result-rank span { font-size: 11px; font-weight: 600; color: var(--muted-2); }
```

- [ ] **Step 6: 통과 확인**

```bash
node app/test/test-lottery.js
node app/test/local-server.js 8899 &
sleep 1
node app/test/browser-test.js
kill %1
```
Expected: 두 스크립트 모두 `== 전부 통과 ==`, 콘솔 오류 `없음`. `app/test/shots/04-check-result.png`(1게임 1등)과 `08-check-multi.png`(2게임 결과)를 눈으로 확인 — 게임 줄·요약·강조/흐림이 스펙 3절과 일치해야 한다.

- [ ] **Step 7: 커밋**

```bash
git add app/index.html app/js/check.js app/css/check.css app/css/components.css app/test/browser-test.js app/test/shots
git commit -m "$(cat <<'EOF'
당첨확인 확장 3/5: 다게임(A~E) 입력·게임별 결과 화면

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: QR 스캔 모듈 + 오버레이 + 사진 폴백 (자동 검증 포함)

**Files:**
- Create: `app/js/qr-scan.js`
- Create: `app/test/vendor/qrcode-generator.js` (다운로드, 테스트 전용)
- Create: `app/test/qr-fixture.js`
- Modify: `app/index.html` (오버레이 마크업 + script 태그)
- Modify: `app/css/check.css` (오버레이 스타일)
- Test: `app/test/browser-test.js` (QR 시나리오 — 다게임 시나리오 뒤, 통계 탭 구간 **앞**에 추가)

**Interfaces:**
- Consumes: Task 2의 전역 `jsQR(data, w, h)`, Task 3의 `onQrText` 연결(이미 `qr-scan-btn` 리스너에 가드로 묶여 있음), DOM id `qr-scan-btn`
- Produces: `Lotto.qrscan.open(cb: (text: string) => void)` — 오버레이를 열고, 카메라(가능 시) 또는 사진 파일에서 QR을 읽으면 오버레이를 닫고 `cb(문자열)` 호출. DOM id: `qr-overlay`, `qr-video`, `qr-hint`, `qr-file-btn`, `qr-file-input`, `qr-close-btn`
- 테스트 인터페이스: `require('./qr-fixture.js').makeQrBmp(text) → Buffer` (BMP 이미지)

**주의(테스트 순서):** QR 시나리오는 반드시 기존 `Page.addScriptToEvaluateOnNewDocument`(fetch 바꿔치기) 구간들 **앞**에 넣는다 — 그 스크립트들은 세션에 계속 남아 이후 내비게이션을 오염시킨다.

- [ ] **Step 1: 테스트 도구 준비 (qrcode-generator vendored + BMP 픽스처)**

```bash
mkdir -p app/test/vendor
curl -sL -o app/test/vendor/qrcode-generator.js https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js
node -e "const q = require('./app/test/vendor/qrcode-generator.js'); const qr = q(0, 'M'); qr.addData('hello'); qr.make(); console.log(qr.getModuleCount() > 0 ? 'OK' : 'BAD')"
```
Expected: `OK`. (실패하면 `https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/js/qrcode.js` 경로로 재시도)

`app/test/qr-fixture.js` 생성:

```js
// qr-fixture.js — 테스트 전용: 문자열 → QR 코드가 그려진 24비트 BMP 버퍼 (의존성 없음).
// browser-test가 이 이미지를 "사진에서 불러오기" 입력에 넣어 QR 해독 경로를 자동 검증한다.
const qrcode = require('./vendor/qrcode-generator.js');

function makeQrBmp(text, cell = 8, margin = 4) {
  const qr = qrcode(0, 'M'); // 타입 자동, 오류정정 M
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * cell;
  const rowBytes = Math.ceil(size * 3 / 4) * 4; // BMP 행은 4바이트 배수
  const dataSize = rowBytes * size;
  const buf = Buffer.alloc(54 + dataSize, 0);
  buf.fill(0xff, 54); // 픽셀 영역은 흰색으로
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + dataSize, 2);
  buf.writeUInt32LE(54, 10);      // 픽셀 시작
  buf.writeUInt32LE(40, 14);      // BITMAPINFOHEADER
  buf.writeInt32LE(size, 18);
  buf.writeInt32LE(size, 22);     // 양수 = 아래→위 저장
  buf.writeUInt16LE(1, 26);       // planes
  buf.writeUInt16LE(24, 28);      // 24bpp
  buf.writeUInt32LE(dataSize, 34);
  for (let y = 0; y < size; y++) {          // y: 위에서부터
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / cell) - margin;
      const col = Math.floor(x / cell) - margin;
      const dark = row >= 0 && row < n && col >= 0 && col < n && qr.isDark(row, col);
      if (dark) {
        const off = 54 + (size - 1 - y) * rowBytes + x * 3;
        buf[off] = 0; buf[off + 1] = 0; buf[off + 2] = 0;
      }
    }
  }
  return buf;
}

module.exports = { makeQrBmp };
```

검증: `node -e "const {makeQrBmp} = require('./app/test/qr-fixture.js'); const b = makeQrBmp('test'); console.log(b.slice(0,2).toString(), b.length > 1000 ? 'OK' : 'BAD')"`
Expected: `BM OK`

- [ ] **Step 2: 실패하는 브라우저 테스트 추가**

`app/test/browser-test.js` 상단 require 근처에 추가:

```js
const { makeQrBmp } = require('./qr-fixture.js');
```

기대값 fetch 구간(`const round1 = await fetchData(...)` 줄 아래)에 추가 — chip에 없는 옛 회차 검증용:

```js
  const oldRound = await fetchData('/api/draw?round=' + (latest.round - 10)); // chip(최근 5개) 밖 회차
```

Task 3에서 추가한 "게임 추가 한도(5)와 삭제" 블록 **바로 뒤**(통계 탭 구간 앞)에 추가:

```js
  // ---- QR 스캔: 사진 경로로 자동 검증 (카메라는 헤드리스에서 불가 — 배포 전 실물 확인은 사장 몫) ----
  const pad2 = (n) => String(n).padStart(2, '0');
  const qrGood = 'https://m.dhlottery.co.kr/qr.do?method=winQr&v=' + prevRound.round
    + 'q' + prevRound.numbers.map(pad2).join('')
    + 'q' + losing.map(pad2).join('');
  const qrFuture = 'https://m.dhlottery.co.kr/qr.do?method=winQr&v=' + (latest.round + 1) + 'q010203040506';
  const qrBad = 'https://example.com/not-a-lotto-ticket';
  const fixture = (name, text) => {
    const p = path.join(os.tmpdir(), name);
    fs.writeFileSync(p, makeQrBmp(text));
    return p;
  };
  const goodPath = fixture('lotto-qr-good.bmp', qrGood);
  const futurePath = fixture('lotto-qr-future.bmp', qrFuture);
  const badPath = fixture('lotto-qr-bad.bmp', qrBad);

  await send('DOM.enable');
  const uploadQr = async (filePath) => {
    await evaluate(`document.getElementById('qr-scan-btn').click()`);
    await sleep(400); // 오버레이 열림 + (헤드리스) 카메라 실패 → 사진 폴백 표시
    const doc = await send('DOM.getDocument');
    const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#qr-file-input' });
    await send('DOM.setFileInputFiles', { files: [filePath], nodeId: node.result.nodeId });
    await sleep(900); // FileReader + 해독 + (캐시된) 회차 데이터 + 결과
  };

  // (1) 정상 2게임 QR → 자동으로 게임별 결과까지
  await uploadQr(goodPath);
  const qrResult = await evaluate(`(function(){
    var rows = document.querySelectorAll('#game-results .game-result-row');
    return { overlayHidden: document.getElementById('qr-overlay').hidden,
      rows: rows.length,
      rankA: rows[0] ? rows[0].querySelector('.game-result-rank').textContent : '',
      rankB: rows[1] ? rows[1].querySelector('.game-result-rank').textContent : '',
      summary: document.getElementById('result-summary').textContent,
      gameRows: document.querySelectorAll('#games-list .game-row').length };
  })()`);
  assert('QR 사진 인식 → 2게임 자동 결과 (A=1등, B=낙첨)',
    qrResult.overlayHidden && qrResult.rows === 2 && qrResult.gameRows === 2 &&
    /1등/.test(qrResult.rankA) && /낙첨/.test(qrResult.rankB), JSON.stringify(qrResult));
  assert('QR 요약 줄', /2게임 중 1등 1개/.test(qrResult.summary), qrResult.summary);
  await shot('09-check-qr.png');

  // (1-b) chip에 없는 옛 회차 QR → 임시 chip 맨 앞 + 자동 결과 (스펙 3-4)
  const qrOld = 'https://m.dhlottery.co.kr/qr.do?method=winQr&v=' + oldRound.round
    + 'q' + oldRound.numbers.map(pad2).join('');
  const oldPath = fixture('lotto-qr-old.bmp', qrOld);
  await uploadQr(oldPath);
  assert('옛 회차 QR: 결과 표시', await waitFor(`!document.getElementById('check-result').hidden`));
  const oldView = await evaluate(`(function(){
    var chips = document.getElementById('round-chips').children;
    var rows = document.querySelectorAll('#game-results .game-result-row');
    return { firstChip: chips[0].textContent, firstActive: chips[0].classList.contains('is-active'),
      chipCount: chips.length, rows: rows.length,
      rankA: rows[0] ? rows[0].querySelector('.game-result-rank').textContent : '' };
  })()`);
  assert('옛 회차 QR: 임시 chip 맨 앞 + A게임 1등',
    oldView.firstChip === oldRound.round + '회' && oldView.firstActive &&
    oldView.chipCount === 6 && oldView.rows === 1 && /1등/.test(oldView.rankA), JSON.stringify(oldView));

  // (2) 아직 추첨 전 회차 QR → 안내 문구
  await uploadQr(futurePath);
  const futureNotice = await evaluate(`!document.getElementById('check-notice').hidden && document.getElementById('check-notice').textContent`);
  assert('추첨 전 회차 QR 안내',
    new RegExp('이 용지는 ' + (latest.round + 1) + '회예요').test(futureNotice || '') &&
    /토요일 추첨 후/.test(futureNotice || ''), futureNotice);

  // (3) 로또가 아닌 QR → 안내 문구
  await uploadQr(badPath);
  const badNotice = await evaluate(`!document.getElementById('check-notice').hidden && document.getElementById('check-notice').textContent`);
  assert('로또 아닌 QR 안내', /로또 용지의 QR 코드를 찾지 못했어요/.test(badNotice || ''), badNotice);

  // (4) 오버레이 닫기 버튼
  await evaluate(`document.getElementById('qr-scan-btn').click()`);
  await sleep(300);
  await evaluate(`document.getElementById('qr-close-btn').click()`);
  assert('오버레이 닫기', await evaluate(`document.getElementById('qr-overlay').hidden`) === true);
```

- [ ] **Step 3: 실패 확인**

```bash
node app/test/local-server.js 8899 &
sleep 1
node app/test/browser-test.js
kill %1
```
Expected: QR 구간 FAIL (`#qr-overlay` 없음 등). Task 3까지의 구간은 PASS 유지.

- [ ] **Step 4: 오버레이 마크업 + script 태그**

(a) `app/index.html`에서 `</div>` 두 개로 `.frame`/`.page`가 닫힌 뒤, `<script ...lottery.js...>` 줄 앞에 추가:

```html
<!-- QR 스캔 오버레이 (당첨확인 탭에서 사용) — 스펙 3-4 -->
<div class="qr-overlay" id="qr-overlay" hidden>
  <div class="qr-overlay-inner">
    <p class="qr-title">용지 QR로 확인</p>
    <div class="qr-view">
      <video id="qr-video" playsinline muted></video>
      <div class="qr-guide" aria-hidden="true"></div>
    </div>
    <p class="qr-hint" id="qr-hint" role="status">카메라를 켜는 중…</p>
    <button type="button" id="qr-file-btn" class="btn-outline qr-file-btn">사진에서 불러오기</button>
    <button type="button" id="qr-close-btn" class="btn-ghost qr-close-btn">닫기</button>
    <input type="file" id="qr-file-input" accept="image/*" hidden>
  </div>
</div>
```

(b) script 태그: `<script src="js/check.js" defer></script>` 줄 **바로 위**에:

```html
<script src="js/qr-scan.js" defer></script>
```

- [ ] **Step 5: `app/js/qr-scan.js` 생성**

```js
// qr-scan.js — QR 읽기 담당. 카메라(또는 사진 파일)에서 QR "문자열 하나"를 얻어 돌려줄 뿐,
// 해석(lottery.js parseTicketQr)이나 화면 상태(check.js)는 모른다. (스펙 6절 경계)
// 사용: Lotto.qrscan.open(function (text) { ... }) — 인식 성공 시 오버레이를 닫고 text 전달.

window.Lotto = window.Lotto || {};

Lotto.qrscan = (function () {
  var el = {};
  var stream = null;    // 카메라 MediaStream — 닫을 때 반드시 stop (불빛 꺼짐)
  var timer = null;     // 카메라 프레임 스캔 주기
  var onResult = null;
  var lastFocus = null; // 오버레이 닫으면 원래 포커스로 복귀 (접근성)
  var canvas = null, ctx = null;

  function init() {
    el.overlay = document.getElementById('qr-overlay');
    el.video = document.getElementById('qr-video');
    el.hint = document.getElementById('qr-hint');
    el.fileBtn = document.getElementById('qr-file-btn');
    el.fileInput = document.getElementById('qr-file-input');
    el.closeBtn = document.getElementById('qr-close-btn');
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    el.closeBtn.addEventListener('click', close);
    el.fileBtn.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', onFile);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !el.overlay.hidden) close();
    });
  }

  function open(cb) {
    if (!el.overlay) init();
    onResult = cb;
    lastFocus = document.activeElement;
    el.fileInput.value = '';
    el.hint.textContent = '카메라를 켜는 중…';
    el.video.hidden = false;
    el.overlay.hidden = false;
    el.closeBtn.focus();
    startCamera();
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraFail();
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(function (s) {
        if (el.overlay.hidden) { stopTracks(s); return; } // 기다리는 동안 닫았으면 바로 끔
        stream = s;
        el.video.srcObject = s;
        el.video.play();
        el.hint.textContent = '용지의 QR 코드를 화면에 비춰주세요';
        timer = setInterval(scanFrame, 300);
      })
      .catch(cameraFail);
  }

  function cameraFail() {
    // 권한 거부·카메라 없음·미지원 → 사진 폴백만 안내 (스펙 5절)
    el.video.hidden = true;
    el.hint.textContent = '카메라를 쓸 수 없어요. 아래 "사진에서 불러오기"로 QR이 찍힌 사진을 골라주세요.';
  }

  function scanFrame() {
    if (!stream || el.video.readyState < 2) return;
    var w = el.video.videoWidth, h = el.video.videoHeight;
    if (!w || !h) return;
    var text = decodeOn(el.video, w, h);
    if (text) finish(text);
  }

  function onFile() {
    var file = el.fileInput.files && el.fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        // 큰 사진은 줄여서 해독 (속도·메모리)
        var scale = Math.min(1, 1200 / Math.max(img.width, img.height));
        var text = decodeOn(img, Math.round(img.width * scale), Math.round(img.height * scale));
        if (text) finish(text);
        else el.hint.textContent = '사진에서 QR 코드를 찾지 못했어요. 초점이 맞은 사진으로 다시 시도해주세요.';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function decodeOn(source, w, h) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(source, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    var code = window.jsQR ? jsQR(data.data, w, h) : null;
    return code && code.data ? code.data : null;
  }

  function finish(text) {
    var cb = onResult; // close()가 onResult를 지우므로 먼저 붙잡는다
    close();
    if (cb) cb(text);
  }

  function stopTracks(s) {
    s.getTracks().forEach(function (t) { t.stop(); });
  }

  function close() {
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stopTracks(stream); stream = null; }
    el.video.srcObject = null;
    el.overlay.hidden = true;
    onResult = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  return { open: open };
})();
```

- [ ] **Step 6: 오버레이 CSS**

`app/css/check.css` 맨 끝에 추가:

```css
/* ---- QR 스캔 오버레이 (스펙 3-4) ---- */
.qr-overlay {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(22, 27, 34, .93);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.qr-overlay[hidden] { display: none; }
.qr-overlay-inner { width: min(100%, 380px); text-align: center; }
.qr-title { margin: 0 0 12px; color: #fff; font-size: 17px; font-weight: 800; }
.qr-view { position: relative; border-radius: 18px; overflow: hidden; background: #000; }
.qr-view:has(> #qr-video[hidden]) { display: none; } /* 카메라 실패 시 뷰 전체 숨김 */
#qr-video { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; }
.qr-guide {
  position: absolute; left: 50%; top: 50%; width: 200px; height: 200px;
  transform: translate(-50%, -50%);
  border: 2.5px solid rgba(255, 255, 255, .85); border-radius: 14px;
}
.qr-hint { margin: 14px 0; color: #e7ebef; font-size: 14px; font-weight: 600; }
.qr-file-btn { width: 100%; background: #fff; color: var(--ink); margin-bottom: 4px; }
.qr-close-btn { color: #cfd6dc; }
```

- [ ] **Step 7: 통과 확인**

```bash
node app/test/test-lottery.js
node app/test/local-server.js 8899 &
sleep 1
node app/test/browser-test.js
kill %1
```
Expected: 두 스크립트 모두 `== 전부 통과 ==`, 콘솔 오류 `없음`. `09-check-qr.png`에서 2게임 자동 결과 확인.

- [ ] **Step 8: 커밋**

```bash
git add app/js/qr-scan.js app/index.html app/css/check.css app/test/vendor/qrcode-generator.js app/test/qr-fixture.js app/test/browser-test.js app/test/shots
git commit -m "$(cat <<'EOF'
당첨확인 확장 4/5: QR 스캔(카메라+사진 폴백) 오버레이와 자동 검증

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 전체 회귀 + 보고서 + 사장 확인 준비

**Files:**
- Modify: `reports/report-front.md` (맨 아래에 이번 작업 보고 추가)

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: 보고서. 배포는 하지 않는다(사장 지시 대기).

- [ ] **Step 1: 전체 회귀 실행**

```bash
node app/test/test-lottery.js
node app/test/local-server.js 8899 &
sleep 1
node app/test/browser-test.js
kill %1
```
Expected: 둘 다 `== 전부 통과 ==`, `콘솔 오류: 없음`. 추첨 모드·통계 등 기존 시나리오 회귀 없음.

- [ ] **Step 2: 스크린샷 육안 점검**

`app/test/shots/`의 `01`~`09` 전부 열어 확인. 특히:
- `04-check-result.png` — 1게임 결과(요약 + A게임 줄)
- `08-check-multi.png` — 2게임 결과(맞은 공/흐린 공 구분)
- `09-check-qr.png` — QR 자동 입력 후 결과
- 기존 `01~03, 05~07` — 다른 탭이 안 깨졌는지

- [ ] **Step 3: 보고서 작성**

`reports/report-front.md` 맨 아래에 추가 — 형식은 기존 Phase 4 절과 동일하게: **한 일 / 만들고 바꾼 파일 / 확인한 것(테스트·스크린샷 근거) / 막힌 것·주의**. "주의"에는 반드시 포함: (1) QR 꼬리(일련번호) 형식은 인쇄 변형 가능 — 파서가 너그럽게 무시하며, **배포 전 사장 실물 스캔 확인이 남은 관문**(스펙 8절 4번). (2) 카메라 경로는 자동화 불가 — 사진 경로로만 자동 검증됨.

- [ ] **Step 4: 커밋**

```bash
git add reports/report-front.md
git commit -m "$(cat <<'EOF'
당첨확인 확장 5/5: 전체 회귀 통과 및 프론트 보고서 갱신

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: 사장 보고**

쉬운 말로 보고: 뭐가 됐는지(5게임 확인 + QR), 어떻게 확인했는지(자동 테스트 + 스크린샷), 남은 관문(사장 실물 용지 스캔 → 통과하면 배포 지시 대기). **배포(`git push`)는 사장이 시키기 전까지 하지 않는다.**

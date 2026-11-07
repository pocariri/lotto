// browser-test.js — 크롬(headless)으로 앱을 실제로 눌러보며 세 탭을 검증하는 스크립트.
// 실데이터(api/ 서버 함수) 기준이라, 먼저 로컬 서버가 떠 있어야 한다:
//   1) node app/test/local-server.js 8899
//   2) node app/test/browser-test.js
// 스크린샷은 app/test/shots/ 에 저장된다.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeQrBmp } = require('./qr-fixture.js');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:8899';
const OUT = path.join(__dirname, 'shots');
const PORT = 9333;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(name, cond, detail) {
  if (cond) console.log('PASS:', name);
  else { console.error('FAIL:', name, detail || ''); failures++; }
}

async function fetchData(url) {
  const body = await (await fetch(BASE + url)).json();
  if (!body.ok) throw new Error(url + ' 실패: ' + JSON.stringify(body.error));
  return body.data;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // 기대값을 서버에서 직접 받아둔다 (화면과 같은 출처)
  const latest = await fetchData('/api/draw');
  const stats = await fetchData('/api/stats');
  const prevRound = await fetchData('/api/draw?round=' + (latest.round - 1));
  const round1 = await fetchData('/api/draw?round=1'); // 1등 당첨자 0명 회차
  const oldRound = await fetchData('/api/draw?round=' + (latest.round - 10)); // chip(최근 5개) 밖 회차

  // 크롬 프로필(잡파일 수십 MB)은 저장소 밖 시스템 임시 폴더에 만든다
  const profile = path.join(os.tmpdir(), 'lotto-browser-test-chrome-profile');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--window-size=440,900',
    '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    try {
      const res = await fetch(`http://localhost:${PORT}/json`);
      targets = await res.json();
      if (targets.length) break;
    } catch (e) { /* 아직 안 열림 */ }
  }
  if (!targets) { console.error('크롬 디버깅 포트 연결 실패'); chrome.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')
      consoleErrors.push(msg.params.entry.text);
    if (msg.method === 'Runtime.exceptionThrown')
      consoleErrors.push(JSON.stringify(msg.params.exceptionDetails.exception || msg.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) consoleErrors.push('evaluate 오류: ' + expr);
    return r.result.result ? r.result.result.value : undefined;
  };
  const waitFor = async (expr, timeoutMs) => {
    const until = Date.now() + (timeoutMs || 15000);
    while (Date.now() < until) {
      if (await evaluate(expr)) return true;
      await sleep(250);
    }
    return false;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    console.log('screenshot:', name);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 440, height: 900, deviceScaleFactor: 2, mobile: true });

  await send('Page.navigate', { url: BASE + '/index.html' });
  await sleep(1200);

  // ---- 추첨 탭 (데이터 무관) ----
  await shot('01-draw-idle.png');
  await evaluate(`document.getElementById('go-picker-btn').click()`);
  await sleep(400);
  const cellClick = (n) => `document.getElementById('picker-grid').children[${n - 1}].click()`;
  await evaluate(cellClick(7));
  await evaluate(cellClick(14));
  await evaluate(cellClick(30)); await evaluate(cellClick(30)); // 고정→제외

  // ---- 추첨 모드 UI (Phase 4) ----
  const modeUi = await evaluate(`({
    labels: ['mode-random','mode-hot','mode-cold'].map(function(id){ return document.getElementById(id).textContent; }),
    randomActive: document.getElementById('mode-random').classList.contains('is-active'),
    strengthHidden: document.getElementById('mode-strength').hidden,
    note: document.querySelector('.mode-note').textContent })`);
  assert('모드 칩 3개, 기본은 완전 랜덤, 강도 숨김',
    JSON.stringify(modeUi.labels) === JSON.stringify(['완전 랜덤', '핫', '콜드']) &&
    modeUi.randomActive && modeUi.strengthHidden, JSON.stringify(modeUi));
  assert('정직 안내 문구 표시', /과거 빈도는 다음 추첨에 영향을 주지 않습니다/.test(modeUi.note), modeUi.note);

  await evaluate(`document.getElementById('mode-hot').click()`);
  const hotUi = await evaluate(`({
    active: document.getElementById('mode-hot').classList.contains('is-active'),
    strengthHidden: document.getElementById('mode-strength').hidden,
    desc: document.getElementById('mode-desc').textContent })`);
  assert('핫 선택 → 강도 버튼 표시 + 설명 변경',
    hotUi.active && !hotUi.strengthHidden && /많이 나온 번호/.test(hotUi.desc), JSON.stringify(hotUi));
  await evaluate(`document.getElementById('strength-strong').click()`);
  await shot('02-draw-picker.png');
  // 이하 추첨은 핫·세게 모드로 진행 — 가중 추첨 경로를 실데이터로 검증
  await evaluate(`document.getElementById('run-draw-btn').click()`);
  await sleep(6500); // 1500 + 780*5 = 5400ms 완료 후 여유
  const drawResult = await evaluate(`(function(){
    var nums = Array.from(document.querySelectorAll('#result-row .ball')).map(function(b){ return parseInt(b.textContent, 10); });
    return { nums: nums, sorted: nums.every(function(n, i){ return i === 0 || nums[i-1] < n; }),
      hasFixed: nums.indexOf(7) !== -1 && nums.indexOf(14) !== -1, noExcluded: nums.indexOf(30) === -1,
      actionsShown: !document.getElementById('draw-actions').hidden };
  })()`);
  assert('추첨(핫·세게): 6개/오름차순/고정포함/제외반영/버튼표시',
    drawResult.nums.length === 6 && drawResult.sorted && drawResult.hasFixed && drawResult.noExcluded && drawResult.actionsShown,
    JSON.stringify(drawResult));
  assert('통계 정상 수신 → 폴백 안내 숨김', await evaluate(`document.getElementById('draw-fallback').hidden`) === true);
  await shot('03-draw-result.png');

  // ---- 상단 라벨 (실데이터) ----
  const label = await evaluate(`document.getElementById('round-label').textContent`);
  assert('상단 라벨 = 제 ' + latest.round + '회', label === '제 ' + latest.round + '회', label);

  // ---- 당첨확인 탭 (실데이터) ----
  await evaluate(`document.getElementById('tab-btn-check').click()`);
  assert('당첨확인 내용 표시됨', await waitFor(`!document.getElementById('check-content').hidden`));

  // chip: 최신부터 5개
  const chipLabels = await evaluate(`Array.from(document.getElementById('round-chips').children).map(function(c){ return c.textContent; })`);
  const expectChips = [0, 1, 2, 3, 4].map(i => (latest.round - i) + '회');
  assert('회차 chip 5개 = 최신부터', JSON.stringify(chipLabels) === JSON.stringify(expectChips), JSON.stringify(chipLabels));

  // 빈 입력 안내 (다게임 문구)
  await evaluate(`document.getElementById('run-check-btn').click()`);
  const emptyNotice = await evaluate(`!document.getElementById('check-notice').hidden && document.getElementById('check-notice').textContent`);
  assert('빈 입력 안내 문구', /번호를 입력하거나 QR을 스캔해 주세요/.test(emptyNotice || ''), emptyNotice);

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

  // ---- 360px 폭 실제 폰에서 게임 줄이 카드 밖으로 넘치지 않는지 (좁은 폰 레이아웃 회귀 방지) ----
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  const overflow360 = await evaluate(`(function(){
    var card = document.querySelector('.entry-card');
    var rows = document.querySelectorAll('#games-list .game-row');
    var bad = 0;
    rows.forEach(function(r){ if (r.scrollWidth > card.clientWidth) bad++; });
    return { bad: bad, cardW: card.clientWidth };
  })()`);
  assert('360px 폭에서 게임 줄 넘침 없음', overflow360.bad === 0, JSON.stringify(overflow360));
  await send('Emulation.setDeviceMetricsOverride', { width: 440, height: 900, deviceScaleFactor: 2, mobile: true });

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

  // 아래 두 실패 케이스(추첨 전/로또 아님)에서 입력칸을 안 건드리는지 검증하려고 지금 상태를 미리 담아둔다
  const gamesSnapshot = () => evaluate(`(function(){
    var rows = document.querySelectorAll('#games-list .game-row');
    var balls = Array.from(document.querySelectorAll('#games-list .entry-ball')).map(function(b){ return b.textContent; }).join(',');
    return { rows: rows.length, balls: balls };
  })()`);
  const gamesBeforeFail = await gamesSnapshot();

  // (2) 아직 추첨 전 회차 QR → 안내 문구
  await uploadQr(futurePath);
  const futureNotice = await evaluate(`!document.getElementById('check-notice').hidden && document.getElementById('check-notice').textContent`);
  assert('추첨 전 회차 QR 안내',
    new RegExp('이 용지는 ' + (latest.round + 1) + '회예요').test(futureNotice || '') &&
    /토요일 추첨 후/.test(futureNotice || ''), futureNotice);
  const gamesAfterFuture = await gamesSnapshot();
  assert('추첨 전 QR: 입력 보존',
    JSON.stringify(gamesAfterFuture) === JSON.stringify(gamesBeforeFail),
    JSON.stringify({ before: gamesBeforeFail, after: gamesAfterFuture }));

  // (3) 로또가 아닌 QR → 안내 문구
  await uploadQr(badPath);
  const badNotice = await evaluate(`!document.getElementById('check-notice').hidden && document.getElementById('check-notice').textContent`);
  assert('로또 아닌 QR 안내', /로또 용지의 QR 코드를 찾지 못했어요/.test(badNotice || ''), badNotice);
  const gamesAfterBad = await gamesSnapshot();
  assert('로또 아닌 QR: 입력 보존',
    JSON.stringify(gamesAfterBad) === JSON.stringify(gamesBeforeFail),
    JSON.stringify({ before: gamesBeforeFail, after: gamesAfterBad }));

  // (4) 오버레이 닫기 버튼
  await evaluate(`document.getElementById('qr-scan-btn').click()`);
  await sleep(300);
  await evaluate(`document.getElementById('qr-close-btn').click()`);
  assert('오버레이 닫기', await evaluate(`document.getElementById('qr-overlay').hidden`) === true);

  // ---- 통계 탭 (실데이터) ----
  await evaluate(`document.getElementById('tab-btn-stats').click()`);
  assert('통계 내용 표시됨', await waitFor(`!document.getElementById('stats-content').hidden`));
  const statsView = await evaluate(`({
    label: document.getElementById('stats-label').textContent,
    hot: Array.from(document.getElementById('hot-balls').children).map(function(b){ return parseInt(b.textContent, 10); }),
    cold: Array.from(document.getElementById('cold-balls').children).map(function(b){ return parseInt(b.textContent, 10); }),
    rows: document.getElementById('freq-list').children.length,
    odd: document.getElementById('oe-odd').textContent })`);
  assert('통계 라벨', statsView.label === '제 1~' + stats.latestRound + '회차 누적 기준', statsView.label);
  assert('자주 나온 번호 = 서버 값 그대로',
    JSON.stringify(statsView.hot) === JSON.stringify(stats.mostFrequent.map(o => o.number)), JSON.stringify(statsView.hot));
  assert('드문 번호 = 서버 값 그대로 (동률 규칙 포함)',
    JSON.stringify(statsView.cold) === JSON.stringify(stats.leastFrequent.map(o => o.number)), JSON.stringify(statsView.cold));
  assert('빈도 45줄', statsView.rows === 45, statsView.rows);
  const expectOddPct = Math.round((stats.oddEven.odd / (stats.oddEven.odd + stats.oddEven.even)) * 100);
  assert('홀짝 막대 = 서버 개수의 퍼센트', statsView.odd === '홀 ' + expectOddPct + '%', statsView.odd);
  await shot('05-stats.png');

  // ---- 1등 당첨자 0명 회차 표시 (최신 요청을 1회차로 바꿔치기해서 검증) ----
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (function () {
      var of = window.fetch;
      window.fetch = function (u, o) {
        if (typeof u === 'string' && u === '/api/draw') u = '/api/draw?round=1';
        return of.call(this, u, o);
      };
    })();` });
  await send('Page.navigate', { url: BASE + '/index.html' });
  await evaluate(`void 0`); // 네비게이션 후 컨텍스트 워밍업
  await sleep(800);
  await evaluate(`document.getElementById('tab-btn-check').click()`);
  assert('(0명 검증) 내용 표시됨', await waitFor(`!document.getElementById('check-content').hidden`));
  const chipCount = await evaluate(`document.getElementById('round-chips').children.length`);
  assert('(0명 검증) 1회차 기준 chip은 1개뿐 (0회차 없음)', chipCount === 1, chipCount);
  await evaluate(`(function(){
    var pad = document.getElementById('pad-grid');
    ${JSON.stringify(round1.numbers)}.forEach(function(n){ pad.children[n-1].click(); });
  })()`);
  await evaluate(`document.getElementById('run-check-btn').click()`);
  await sleep(300);
  const zeroPrize = await evaluate(`document.getElementById('prize-text').textContent`);
  assert('(0명 검증) "1등 당첨자 없음" 표시',
    round1.firstPrize.winners === 0 ? zeroPrize === '이 회차는 1등 당첨자 없음' : true, zeroPrize);
  await shot('06-check-no-winner.png');

  // ---- 통계 실패 폴백 (핫/콜드인데 /api/stats가 죽어 있으면 완전 랜덤으로 뽑고 안내) ----
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (function () {
      var of = window.fetch;
      window.fetch = function (u, o) {
        if (typeof u === 'string' && u.indexOf('/api/stats') === 0)
          return Promise.reject(new TypeError('통계 차단(테스트)'));
        return of.call(this, u, o);
      };
    })();` });
  await send('Page.navigate', { url: BASE + '/index.html' });
  await evaluate(`void 0`);
  await sleep(800);
  await evaluate(`document.getElementById('go-picker-btn').click()`);
  await sleep(300);
  await evaluate(`document.getElementById('mode-cold').click()`);
  await evaluate(`document.getElementById('run-draw-btn').click()`);
  await sleep(6800);
  const fb = await evaluate(`(function(){
    var nums = Array.from(document.querySelectorAll('#result-row .ball')).map(function(b){ return parseInt(b.textContent, 10); });
    return { count: nums.length, fallbackShown: !document.getElementById('draw-fallback').hidden,
      text: document.getElementById('draw-fallback').textContent };
  })()`);
  assert('통계 실패 → 완전 랜덤 6개 + 안내 표시',
    fb.count === 6 && fb.fallbackShown && /완전 랜덤으로 뽑았어요/.test(fb.text), JSON.stringify(fb));
  await shot('07-draw-fallback.png');

  console.log('콘솔 오류:', consoleErrors.length ? consoleErrors : '없음');
  if (consoleErrors.length) failures++;

  // ---- PWA: 앱 정보·아이콘·서비스 워커·진짜 오프라인 실행 ----
  // 전용 임시 서버(다른 포트 = 별도 출처)를 띄웠다가 "꺼버리고" 다시 열어서, 저장본으로 화면이 뜨는지 본다.
  // (오프라인에선 데이터 요청 실패가 콘솔에 찍히는 게 정상이라, 위의 콘솔 오류 집계 뒤에 둔다)
  const PWA_PORT = 8898;
  const PWA_BASE = `http://localhost:${PWA_PORT}`;
  const pwaServer = spawn(process.execPath, [path.join(__dirname, 'local-server.js'), String(PWA_PORT)], { stdio: 'ignore' });
  let pwaUp = false;
  for (let i = 0; i < 40 && !pwaUp; i++) {
    await sleep(200);
    try { pwaUp = (await fetch(PWA_BASE + '/index.html')).ok; } catch (e) { /* 대기 */ }
  }
  assert('PWA 임시 서버 실행', pwaUp);

  await send('Page.navigate', { url: PWA_BASE + '/' });
  await sleep(1000);
  const pwa = await evaluate(`(async function(){
    var link = document.querySelector('link[rel=manifest]');
    var m = await (await fetch(link.href)).json();
    var sizes = await Promise.all(m.icons.map(function(ic){
      return new Promise(function(res){
        var img = new Image();
        img.onload = function(){ res({ src: ic.src, want: ic.sizes, got: img.naturalWidth + 'x' + img.naturalHeight, purpose: ic.purpose }); };
        img.onerror = function(){ res({ src: ic.src, want: ic.sizes, got: 'LOAD_FAIL' }); };
        img.src = new URL(ic.src, link.href).href;
      });
    }));
    var apple = document.querySelector('link[rel=apple-touch-icon]');
    var appleSize = await new Promise(function(res){
      var img = new Image(); img.onload = function(){ res(img.naturalWidth); }; img.onerror = function(){ res(0); }; img.src = apple.href;
    });
    return { name: m.name, display: m.display, start: m.start_url, theme: m.theme_color,
      themeMeta: document.querySelector('meta[name=theme-color]').content,
      icons: sizes, appleSize: appleSize };
  })()`);
  assert('manifest: 이름·standalone·시작주소',
    pwa.name === '로또 드로우' && pwa.display === 'standalone' && pwa.start === '/' && pwa.theme === pwa.themeMeta,
    JSON.stringify(pwa));
  assert('manifest 아이콘 전부 열리고 크기 일치 (192·512·maskable)',
    pwa.icons.length === 3 && pwa.icons.every(i => i.got === i.want) && pwa.icons.some(i => i.purpose === 'maskable'),
    JSON.stringify(pwa.icons));
  assert('아이폰용 아이콘 180px', pwa.appleSize === 180, String(pwa.appleSize));

  // 상태바(시계·배터리) 뒤 색 = body 배경. 앱 모드(폰)에선 프레임 맨 위 색과 같아야 끊김이 없다.
  // (헤드리스 크롬은 display-mode 흉내를 받기만 하고 적용하지 않음 — 2026-11-07 확인.
  //  그래서 앱 모드 규칙을 스타일시트에서 직접 찾아, 그 색이 프레임 맨 위 색과 같은지 본다.)
  const bg = await evaluate(`(function(){
    var rule = null;
    Array.from(document.styleSheets).forEach(function(s){
      try { Array.from(s.cssRules).forEach(function(r){
        if (r.conditionText && /display-mode:\\s*standalone/.test(r.conditionText)) rule = r;
      }); } catch (e) {}
    });
    var probe = document.createElement('div');
    document.body.appendChild(probe);
    var color = function(v){ probe.style.backgroundColor = ''; probe.style.backgroundColor = v; return getComputedStyle(probe).backgroundColor; };
    var inner = rule ? rule.cssRules[0] : null;
    var frameTop = (getComputedStyle(document.querySelector('.frame')).backgroundImage.match(/rgb\\([^)]*\\)/) || [''])[0];
    var out = {
      browser: getComputedStyle(document.body).backgroundColor + '|' + getComputedStyle(document.querySelector('.page')).backgroundColor,
      condition: rule ? rule.conditionText : null,
      selector: inner ? inner.selectorText : null,
      appBg: inner ? color(inner.style.background || inner.style.backgroundColor) : null,
      frameTop: frameTop
    };
    probe.remove();
    return out;
  })()`);
  assert('일반 브라우저: 바깥 배경은 디자인 회색 그대로', bg.browser === 'rgb(205, 209, 213)|rgb(197, 202, 207)', JSON.stringify(bg));
  assert('홈 화면 앱(폰 폭) 규칙: body·.page 배경 = 프레임 맨 위 색 #eef1f4',
    /max-width:\s*440px/.test(bg.condition) && /body/.test(bg.selector) && /\.page/.test(bg.selector) &&
    bg.appBg === 'rgb(238, 241, 244)' && bg.frameTop === bg.appBg, JSON.stringify(bg));

  const swReady = await waitFor(`navigator.serviceWorker.ready.then(function(r){ return !!r.active; })`, 10000);
  assert('서비스 워커 설치·활성', swReady);
  await send('Page.reload');
  await sleep(1000);
  const controlled = await evaluate(`!!navigator.serviceWorker.controller`);
  assert('새로고침 후 서비스 워커가 화면을 담당', controlled);
  const swPassApi = await evaluate(`(async function(){
    var r = await fetch('/api/draw'); var b = await r.json(); return b.ok === true && b.data.round > 0;
  })()`);
  assert('온라인일 때 /api 데이터 정상 (서비스 워커가 가로채지 않음)', swPassApi);

  // 서버를 꺼서 진짜 오프라인을 만든다
  pwaServer.kill();
  await sleep(500);
  let serverDown = false;
  try { await fetch(PWA_BASE + '/index.html'); } catch (e) { serverDown = true; }
  assert('PWA 임시 서버 종료 확인 (오프라인 상태)', serverDown);

  await send('Page.navigate', { url: PWA_BASE + '/' });
  await sleep(1500);
  const offline = await evaluate(`(function(){
    var cssOk = getComputedStyle(document.querySelector('.frame')).maxWidth === '440px';
    var title = document.querySelector('.draw-idle h1');
    return { title: title ? title.textContent : null, cssOk: cssOk, hasLotto: typeof Lotto === 'object' };
  })()`);
  assert('오프라인: 앱 화면이 저장본으로 열림 (HTML·CSS·JS)',
    offline.title && /행운의 번호/.test(offline.title) && offline.cssOk && offline.hasLotto, JSON.stringify(offline));
  await evaluate(`document.getElementById('go-picker-btn').click()`);
  await sleep(300);
  await evaluate(`document.getElementById('run-draw-btn').click()`);
  await sleep(6500);
  const offlineDraw = await evaluate(`Array.from(document.querySelectorAll('#result-row .ball')).length`);
  assert('오프라인: 추첨 탭은 끝까지 동작 (공 6개)', offlineDraw === 6, String(offlineDraw));
  await shot('10-pwa-offline-draw.png');

  ws.close();
  chrome.kill();
  console.log(failures === 0 ? '\n== 전부 통과 ==' : '\n== 실패 ' + failures + '건 ==');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

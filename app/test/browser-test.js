// browser-test.js — 크롬(headless)으로 앱을 실제로 눌러보며 세 탭을 검증하는 스크립트.
// 실데이터(api/ 서버 함수) 기준이라, 먼저 로컬 서버가 떠 있어야 한다:
//   1) node app/test/local-server.js 8899
//   2) node app/test/browser-test.js
// 스크린샷은 app/test/shots/ 에 저장된다.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

  // 빈 입력 안내
  await evaluate(`document.getElementById('run-check-btn').click()`);
  const emptyNotice = await evaluate(`!document.getElementById('check-notice').hidden && document.getElementById('check-notice').textContent`);
  assert('빈 입력 안내 문구', /6개를 모두 채워야/.test(emptyNotice || ''), emptyNotice);

  // 이전 회차 chip 선택 → 그 회차 당첨번호 6개 입력 → 1등
  await evaluate(`document.getElementById('round-chips').children[1].click()`);
  assert('회차 데이터 로딩 완료', await waitFor(`document.getElementById('check-status').hidden`));
  await evaluate(`(function(){
    var pad = document.getElementById('pad-grid');
    ${JSON.stringify(prevRound.numbers)}.forEach(function(n){ pad.children[n-1].click(); });
  })()`);
  await evaluate(`document.getElementById('run-check-btn').click()`);
  await sleep(300);
  const checkResult = await evaluate(`({
    round: document.getElementById('check-round-label').textContent,
    match: document.getElementById('match-text').textContent,
    rank: document.getElementById('rank-text').textContent,
    prize: document.getElementById('prize-text').textContent,
    shown: !document.getElementById('check-result').hidden })`);
  assert('당첨번호 6개 입력 → 1등',
    checkResult.shown && checkResult.rank === '1등' && checkResult.match === '6개 일치' &&
    checkResult.round === prevRound.round + '회 당첨번호', JSON.stringify(checkResult));
  const expectPrize = prevRound.firstPrize.winners > 0
    ? '이 회차 1등: ' + prevRound.firstPrize.winners + '명 · 1인당 ' + prevRound.firstPrize.amountPerWinner.toLocaleString('ko-KR') + '원'
    : '이 회차는 1등 당첨자 없음';
  assert('1등 당첨금 표시', checkResult.prize === expectPrize, checkResult.prize + ' vs ' + expectPrize);
  await shot('04-check-result.png');

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

  ws.close();
  chrome.kill();
  console.log(failures === 0 ? '\n== 전부 통과 ==' : '\n== 실패 ' + failures + '건 ==');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

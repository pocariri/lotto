// test-lottery.js — js/lottery.js 순수 로직 검증.
// 사용: node app/test/test-lottery.js

global.window = global; // 브라우저처럼 window === 전역
require(require('path').join(__dirname, '..', 'js', 'lottery.js'));
const L = window.Lotto.logic;

let failures = 0;
function assert(name, cond) {
  if (cond) console.log('PASS:', name);
  else { console.error('FAIL:', name); failures++; }
}

// 1) 기본 뽑기: 중복 없음, 6개, 오름차순, 1~45 범위
for (let t = 0; t < 500; t++) {
  const r = L.draw([], []);
  const ok = r.length === 6 &&
    new Set(r).size === 6 &&
    r.every((n, i) => n >= 1 && n <= 45 && (i === 0 || r[i - 1] < n));
  if (!ok) { assert('기본 뽑기 #' + t + ' → ' + r, false); break; }
  if (t === 499) assert('기본 뽑기 500회 (중복없음/6개/오름차순/범위)', true);
}

// 2) 고정 포함
for (let t = 0; t < 200; t++) {
  const r = L.draw([7, 14, 43], []);
  if (!(r.includes(7) && r.includes(14) && r.includes(43))) {
    assert('고정 포함 실패: ' + r, false); break;
  }
  if (t === 199) assert('고정 3개 항상 포함 (200회)', true);
}

// 3) 제외 반영
const excluded = [];
for (let i = 1; i <= 30; i++) excluded.push(i); // 1~30 제외 → 31~45만 후보
for (let t = 0; t < 200; t++) {
  const r = L.draw([], excluded);
  if (!r.every(n => n >= 31)) { assert('제외 반영 실패: ' + r, false); break; }
  if (t === 199) assert('제외 30개 반영 (후보 31~45만, 200회)', true);
}

// 4) 고정+제외 함께
for (let t = 0; t < 200; t++) {
  const r = L.draw([31, 45], excluded);
  if (!(r.includes(31) && r.includes(45) && r.every(n => n >= 31))) {
    assert('고정+제외 실패: ' + r, false); break;
  }
  if (t === 199) assert('고정 2 + 제외 30 함께 (200회)', true);
}

// 5) 극단: 제외 39개 → 남은 후보 정확히 6개
const excl39 = [];
for (let i = 1; i <= 39; i++) excl39.push(i);
assert('후보 딱 6개면 그 6개 그대로', JSON.stringify(L.draw([], excl39)) === JSON.stringify([40, 41, 42, 43, 44, 45]));
assert('후보 6개는 통과', L.validate([], excl39).ok === true);

// 6) 검증: 제외 40개 → 후보 5개 → 차단
const excl40 = excl39.concat([40]);
assert('후보 5개면 차단', L.validate([], excl40).ok === false);
assert('차단 메시지 있음', typeof L.validate([], excl40).message === 'string');

// 7) 순환: 기본 → 고정 → 제외 → 기본
let s = { fixed: [], excluded: [] };
s = L.cycle(s.fixed, s.excluded, 5);
assert('탭 1번 → 고정', s.fixed.includes(5) && !s.excluded.includes(5));
s = L.cycle(s.fixed, s.excluded, 5);
assert('탭 2번 → 제외', !s.fixed.includes(5) && s.excluded.includes(5));
s = L.cycle(s.fixed, s.excluded, 5);
assert('탭 3번 → 기본', !s.fixed.includes(5) && !s.excluded.includes(5));

// 8) 고정 6개 꽉 찬 뒤 새 번호는 바로 제외로 (사장 결정 반영)
let full = L.cycle([1, 2, 3, 4, 5, 6], [], 7);
assert('고정 꽉 참 → 새 번호는 제외로', full.fixed.length === 6 && !full.fixed.includes(7) && full.excluded.includes(7));
// 제외된 그 번호를 다시 누르면 기본으로 복귀
full = L.cycle(full.fixed, full.excluded, 7);
assert('제외 → 다시 누르면 기본', !full.excluded.includes(7) && !full.fixed.includes(7));

// 9) 등수 계산
assert('6개=1등', L.rank(6, false) === '1등');
assert('5개+보너스=2등', L.rank(5, true) === '2등');
assert('5개=3등', L.rank(5, false) === '3등');
assert('4개=4등', L.rank(4, false) === '4등');
assert('3개=5등', L.rank(3, false) === '5등');
assert('2개=낙첨', L.rank(2, false) === '낙첨');
assert('2개+보너스=낙첨', L.rank(2, true) === '낙첨');

// 10) 공 색 구간
assert('공 색 구간', L.ballGroup(1) === 'g1' && L.ballGroup(10) === 'g1' &&
  L.ballGroup(11) === 'g2' && L.ballGroup(20) === 'g2' &&
  L.ballGroup(21) === 'g3' && L.ballGroup(30) === 'g3' &&
  L.ballGroup(31) === 'g4' && L.ballGroup(40) === 'g4' &&
  L.ballGroup(41) === 'g5' && L.ballGroup(45) === 'g5');

// ---- Phase 4: 추첨 모드 (핫/콜드 가중 추첨) ----
// ticketWeights(frequency, mode, strength) → 길이 46 배열(weights[n] = 번호 n의 응모권 수)
//   기본 1장 + 빈도 보너스. weak: 최대 2장(2배), strong: 최대 5장(5배). 바닥 1장 보장.
// drawWeighted(fixed, excluded, weights) → draw와 같은 규칙 + 응모권 비례 추첨.

function makeFreq(countFn) {
  const arr = [];
  for (let n = 1; n <= 45; n++) arr.push({ number: n, count: countFn(n) });
  return arr;
}
function tryBlock(name, fn) {
  try { fn(); } catch (e) { assert(name + ' (예외: ' + e.message + ')', false); }
}
const RISING = makeFreq(n => 100 + n); // 번호가 클수록 많이 나온 가상 빈도

// 11) 핫 모드 응모권: 최다 번호가 약하게 2장 / 세게 5장, 최소 번호는 1장, 단조 증가
tryBlock('핫 모드 응모권', () => {
  const weak = L.ticketWeights(RISING, 'hot', 'weak');
  const strong = L.ticketWeights(RISING, 'hot', 'strong');
  assert('핫·약하게: 최다=2장, 최소=1장',
    Math.abs(weak[45] - 2) < 1e-9 && Math.abs(weak[1] - 1) < 1e-9);
  assert('핫·세게: 최다=5장, 최소=1장',
    Math.abs(strong[45] - 5) < 1e-9 && Math.abs(strong[1] - 1) < 1e-9);
  let mono = true;
  for (let n = 2; n <= 45; n++) if (strong[n] < strong[n - 1]) mono = false;
  assert('핫: 빈도 높을수록 응모권 많음(단조)', mono);
});

// 12) 콜드 모드 응모권: 핫의 정반대 — 최소 빈도 번호가 보너스를 받는다
tryBlock('콜드 모드 응모권', () => {
  const weak = L.ticketWeights(RISING, 'cold', 'weak');
  const strong = L.ticketWeights(RISING, 'cold', 'strong');
  assert('콜드·약하게: 최소빈도=2장, 최다빈도=1장',
    Math.abs(weak[1] - 2) < 1e-9 && Math.abs(weak[45] - 1) < 1e-9);
  assert('콜드·세게: 최소빈도=5장, 최다빈도=1장',
    Math.abs(strong[1] - 5) < 1e-9 && Math.abs(strong[45] - 1) < 1e-9);
  // 핫/콜드 대칭: 번호 n의 콜드 응모권 == 번호 46-n의 핫 응모권 (빈도가 선형이므로)
  const hot = L.ticketWeights(RISING, 'hot', 'strong');
  let sym = true;
  for (let n = 1; n <= 45; n++) if (Math.abs(strong[n] - hot[46 - n]) > 1e-9) sym = false;
  assert('핫/콜드 대칭', sym);
});

// 13) frequency 배열 순서가 섞여 있어도 number 기준으로 계산
tryBlock('빈도 배열 순서 무관', () => {
  const shuffled = RISING.slice().reverse();
  const w = L.ticketWeights(shuffled, 'hot', 'strong');
  assert('섞인 배열도 number 기준', Math.abs(w[45] - 5) < 1e-9 && Math.abs(w[1] - 1) < 1e-9);
});

// 14) 빈도가 전부 같으면 전부 1장 (완전 랜덤과 동일) + 바닥/천장 보장
tryBlock('동일 빈도·바닥 보장', () => {
  const flat = L.ticketWeights(makeFreq(() => 150), 'hot', 'strong');
  let allOne = true;
  for (let n = 1; n <= 45; n++) if (Math.abs(flat[n] - 1) > 1e-9) allOne = false;
  assert('전부 같은 빈도 → 전부 1장', allOne);
  const rand = L.ticketWeights(makeFreq(n => 100 + ((n * 37) % 45)), 'cold', 'strong');
  let bounded = true;
  for (let n = 1; n <= 45; n++) if (rand[n] < 1 - 1e-9 || rand[n] > 5 + 1e-9) bounded = false;
  assert('모든 번호 1장 이상 5장 이하', bounded);
});

// 15) 가중 뽑기 기본 성질: 6개/중복없음/오름차순/범위 (500회)
tryBlock('가중 뽑기 기본 성질', () => {
  const w = L.ticketWeights(RISING, 'hot', 'strong');
  for (let t = 0; t < 500; t++) {
    const r = L.drawWeighted([], [], w);
    const ok = r.length === 6 && new Set(r).size === 6 &&
      r.every((n, i) => n >= 1 && n <= 45 && (i === 0 || r[i - 1] < n));
    if (!ok) { assert('가중 뽑기 #' + t + ' → ' + r, false); return; }
  }
  assert('가중 뽑기 500회 (중복없음/6개/오름차순/범위)', true);
});

// 16) 가중 뽑기도 고정 포함·제외 반영
tryBlock('가중 뽑기 고정/제외', () => {
  const w = L.ticketWeights(RISING, 'cold', 'strong');
  const excl = [];
  for (let i = 1; i <= 30; i++) excl.push(i);
  for (let t = 0; t < 200; t++) {
    const r = L.drawWeighted([31, 45], excl, w);
    if (!(r.includes(31) && r.includes(45) && r.every(n => n >= 31))) {
      assert('가중 고정+제외 실패: ' + r, false); return;
    }
  }
  assert('가중 뽑기 고정 2 + 제외 30 (200회)', true);
});

// 17) 성향과 바닥 확률 (통계적 — 여유 큰 기준):
//     세게 핫에서 최다 빈도 번호(45)는 최소 빈도 번호(1)보다 훨씬 자주 나오되, 1번도 꾸준히 나온다
tryBlock('성향·바닥 통계 검증', () => {
  const w = L.ticketWeights(RISING, 'hot', 'strong');
  let c1 = 0, c45 = 0;
  const N = 3000;
  for (let t = 0; t < N; t++) {
    const r = L.drawWeighted([], [], w);
    if (r.includes(1)) c1++;
    if (r.includes(45)) c45++;
  }
  // 기대값: 1번 ≈ 130회(4.4%), 45번 ≈ 660회(22%) — 기준은 그 중간에 널널하게
  assert('세게 핫: 45번이 1번보다 2배 이상 (' + c45 + ' vs ' + c1 + ')', c45 > c1 * 2);
  assert('세게 핫에서도 1번이 고착 없이 계속 나옴 (' + c1 + '회)', c1 > 20);
});

console.log(failures === 0 ? '\n== 전부 통과 ==' : '\n== 실패 ' + failures + '건 ==');
process.exit(failures === 0 ? 0 : 1);

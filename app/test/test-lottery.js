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

console.log(failures === 0 ? '\n== 전부 통과 ==' : '\n== 실패 ' + failures + '건 ==');
process.exit(failures === 0 ? 0 : 1);

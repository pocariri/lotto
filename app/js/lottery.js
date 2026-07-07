// lottery.js — 순수 계산 로직. 화면(DOM)을 전혀 모르는 "머리" 담당.
// 여기 함수들은 숫자만 받고 숫자만 돌려줘서 따로 검증하기 쉽다.

window.Lotto = window.Lotto || {};

Lotto.logic = {
  MIN: 1,
  MAX: 45,
  PICK: 6,

  // 공 색 구간: 1–10 노랑, 11–20 파랑, 21–30 빨강, 31–40 회색, 41–45 초록
  ballGroup(n) {
    if (n <= 10) return 'g1';
    if (n <= 20) return 'g2';
    if (n <= 30) return 'g3';
    if (n <= 40) return 'g4';
    return 'g5';
  },

  // 공 하나에 붙일 CSS 클래스 (크기는 쓰는 쪽에서 ball--50 등으로 추가)
  ballClass(n) {
    return 'ball--' + this.ballGroup(n);
  },

  // 번호 탭 순환: 기본 → 고정 → 제외 → 기본
  // 단, 고정이 6개 꽉 찬 상태에서 누른 새 번호는 바로 제외로 간다.
  cycle(fixed, excluded, n) {
    fixed = fixed.slice();
    excluded = excluded.slice();
    if (fixed.includes(n)) {
      fixed = fixed.filter(function (x) { return x !== n; });
      excluded.push(n);
    } else if (excluded.includes(n)) {
      excluded = excluded.filter(function (x) { return x !== n; });
    } else if (fixed.length >= this.PICK) {
      excluded.push(n);
    } else {
      fixed.push(n);
    }
    return { fixed: fixed, excluded: excluded };
  },

  // 이 조합으로 6개를 뽑을 수 있는지 검사.
  // 고정/제외는 서로 겹치지 않으므로, 제외하고 남은 후보가 6개 미만이면 불가.
  validate(fixed, excluded) {
    var remain = this.MAX - excluded.length;
    if (remain < this.PICK) {
      return {
        ok: false,
        message: '제외한 번호가 너무 많아요. 최소 6개는 남아야 뽑을 수 있어요. (지금 ' + remain + '개 남음)'
      };
    }
    return { ok: true };
  },

  // 뽑기: 제외 빼고, 고정 포함해서 중복 없이 6개 — 오름차순.
  // 반드시 validate 통과 후에 부를 것.
  draw(fixed, excluded) {
    var excl = new Set(excluded);
    var base = fixed.filter(function (n) { return !excl.has(n); }).slice(0, this.PICK);
    var pool = [];
    for (var i = this.MIN; i <= this.MAX; i++) {
      if (!excl.has(i) && base.indexOf(i) === -1) pool.push(i);
    }
    var picks = base.slice();
    while (picks.length < this.PICK) {
      picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return picks.sort(function (a, b) { return a - b; });
  },

  // 맞은 개수(+보너스) → 등수
  rank(matches, bonusHit) {
    if (matches === 6) return '1등';
    if (matches === 5 && bonusHit) return '2등';
    if (matches === 5) return '3등';
    if (matches === 4) return '4등';
    if (matches === 3) return '5등';
    return '낙첨';
  }
};

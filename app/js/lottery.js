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

  // ---- 추첨 모드 (핫/콜드) ----
  // 모든 번호가 기본 응모권 1장을 갖고, 모드에 따라 보너스를 얹는다.
  // 기본 1장은 절대 안 사라지므로 어떤 강도에서도 모든 번호가 최소 확률을 유지한다.

  // 강도 → 보너스 응모권 최대 장수 (weak: 최대 2배, strong: 최대 5배 차이)
  STRENGTH_BONUS: { weak: 1, strong: 4 },

  // 통계 빈도 → 응모권 배열. frequency는 [{number, count} x45] (순서 무관, number 기준).
  // 반환: 길이 46 배열, weights[n] = 번호 n의 응모권 수 (0번 인덱스는 안 씀).
  // mode 'hot'(많이 나온 번호에 보너스) | 'cold'(적게 나온 번호에 보너스)
  ticketWeights(frequency, mode, strength) {
    var bonus = this.STRENGTH_BONUS[strength] || this.STRENGTH_BONUS.weak;
    var counts = frequency.map(function (o) { return o.count; });
    var max = Math.max.apply(null, counts);
    var min = Math.min.apply(null, counts);
    var span = max - min;

    var weights = new Array(this.MAX + 1).fill(1);
    weights[0] = 0;
    if (span === 0) return weights; // 빈도가 전부 같으면 완전 랜덤과 동일

    frequency.forEach(function (o) {
      var t = (o.count - min) / span;            // 0(최소 빈도) ~ 1(최다 빈도)
      if (mode === 'cold') t = 1 - t;            // 콜드는 정반대
      weights[o.number] = 1 + bonus * t;
    });
    return weights;
  },

  // 응모권 비례 뽑기 — draw와 같은 규칙(고정 포함, 제외 제거, 오름차순 6개).
  // 반드시 validate 통과 후에 부를 것.
  drawWeighted(fixed, excluded, weights) {
    var excl = new Set(excluded);
    var base = fixed.filter(function (n) { return !excl.has(n); }).slice(0, this.PICK);
    var pool = [];
    for (var i = this.MIN; i <= this.MAX; i++) {
      if (!excl.has(i) && base.indexOf(i) === -1) pool.push(i);
    }
    var picks = base.slice();
    while (picks.length < this.PICK) {
      var total = 0;
      for (var j = 0; j < pool.length; j++) total += weights[pool[j]];
      var r = Math.random() * total;
      var idx = 0;
      for (var k = 0; k < pool.length; k++) {
        r -= weights[pool[k]];
        if (r < 0) { idx = k; break; }
      }
      picks.push(pool.splice(idx, 1)[0]);
    }
    return picks.sort(function (a, b) { return a - b; });
  },

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

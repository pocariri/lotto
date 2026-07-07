// check.js — 당첨 확인 탭. 회차를 고르고 내 번호 6개를 넣으면 등수를 알려준다.
// 데이터는 Lotto.api(계약 v1.2)에서 실시간으로 받아온다.
// 회차 chip은 최신 회차 번호에서 최근 5개(latest, latest-1, …)를 만들고,
// chip을 고르면 ?round=N으로 그 회차를 받아온다. 등수 계산은 화면 몫(Lotto.logic.rank).

window.Lotto = window.Lotto || {};

Lotto.check = (function () {
  var state = {
    chipRounds: [],       // chip에 보여줄 회차 번호들 (최신부터 최대 5개)
    round: null,          // 지금 고른 회차 번호
    current: null,        // 고른 회차의 데이터 (로딩 중이거나 실패하면 null)
    loading: false,
    entry: [null, null, null, null, null, null],
    activeSlot: 0,
    result: null          // { matches, bonusHit, rank } 또는 null
  };

  var el = {};

  async function init() {
    el.status = document.getElementById('check-status');
    el.content = document.getElementById('check-content');
    el.chips = document.getElementById('round-chips');
    el.entryRow = document.getElementById('entry-row');
    el.padGrid = document.getElementById('pad-grid');
    el.notice = document.getElementById('check-notice');
    el.result = document.getElementById('check-result');
    el.roundLabel = document.getElementById('check-round-label');
    el.winRow = document.getElementById('win-row');
    el.rankBox = document.getElementById('rank-box');
    el.matchText = document.getElementById('match-text');
    el.rankText = document.getElementById('rank-text');
    el.prizeText = document.getElementById('prize-text');

    buildSlots();
    buildPad();
    document.getElementById('run-check-btn').addEventListener('click', runCheck);

    try {
      var latest = await Lotto.api.getDraw();
      state.chipRounds = [];
      for (var i = 0; i < 5; i++) {
        var r = latest.round - i;
        if (r >= 1) state.chipRounds.push(r);
      }
      state.round = latest.round;
      state.current = latest;
      buildChips();
      el.status.hidden = true;
      el.content.hidden = false;
      render();
    } catch (e) {
      showStatus(e.message, true);
    }
  }

  // ---- 화면 부품 만들기 (한 번만) ----

  function buildChips() {
    state.chipRounds.forEach(function (round) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = round + '회';
      b.addEventListener('click', function () { setRound(round); });
      el.chips.appendChild(b);
    });
  }

  function buildSlots() {
    for (var i = 0; i < 6; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.setAttribute('aria-label', (i + 1) + '번째 번호 칸');
      b.addEventListener('click', slotClick(i));
      el.entryRow.appendChild(b);
    }
  }
  function slotClick(i) {
    return function () {
      state.activeSlot = i;
      render();
    };
  }

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
    if (round === state.round && state.current) return; // 이미 보고 있는 회차
    state.round = round;
    state.result = null;
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

  // 패드에서 번호를 누르면: 이미 있으면 빼고, 없으면 선택 중인 칸(또는 빈 칸)에 넣는다
  function padPick(n) {
    el.notice.hidden = true;
    var entry = state.entry.slice();
    var already = entry.indexOf(n);
    if (already !== -1) {
      entry[already] = null;
      state.entry = entry;
      state.result = null;
      render();
      return;
    }
    var i = state.activeSlot;
    if (entry[i] != null) {
      var empty = entry.indexOf(null);
      if (empty === -1) return; // 6칸 다 참
      i = empty;
    }
    entry[i] = n;
    var next = entry.indexOf(null);
    state.entry = entry;
    state.activeSlot = next === -1 ? i : next;
    state.result = null;
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
    var entry = state.entry.filter(function (x) { return x != null; });
    if (entry.length < 6) {
      notice('번호 6개를 모두 채워야 확인할 수 있어요. (지금 ' + entry.length + '개)');
      return;
    }
    el.notice.hidden = true;
    var r = state.current;
    var winSet = new Set(r.numbers);
    var matches = entry.filter(function (n) { return winSet.has(n); }).length;
    var bonusHit = entry.indexOf(r.bonus) !== -1;
    state.result = {
      matches: matches,
      bonusHit: bonusHit,
      rank: Lotto.logic.rank(matches, bonusHit)
    };
    render();
  }

  // ---- 그리기 ----

  function render() {
    // 회차 칩
    var chips = el.chips.children;
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-active', state.chipRounds[i] === state.round);
    }

    // 내 번호 6칸
    var slots = el.entryRow.children;
    for (var s = 0; s < 6; s++) {
      var n = state.entry[s];
      var b = slots[s];
      if (n != null) {
        b.className = 'entry-ball ball ball--44 ' + Lotto.logic.ballClass(n);
        b.textContent = n;
      } else {
        b.className = 'slot' + (s === state.activeSlot ? ' is-active' : '');
        b.textContent = '';
      }
    }

    // 숫자패드
    var cells = el.padGrid.children;
    for (var c = 0; c < cells.length; c++) {
      var num = c + 1;
      var sel = state.entry.indexOf(num) !== -1;
      cells[c].className = 'pad-cell' + (sel ? ' is-selected ' + Lotto.logic.ballClass(num) : '');
    }

    // 결과 카드
    var wasHidden = el.result.hidden;
    if (state.result && state.current) {
      var r = state.current;
      el.roundLabel.textContent = r.round + '회 당첨번호';
      el.winRow.innerHTML = '';
      r.numbers.forEach(function (n) { el.winRow.appendChild(makeBall(n)); });
      var plus = document.createElement('span');
      plus.className = 'plus';
      plus.textContent = '+';
      el.winRow.appendChild(plus);
      el.winRow.appendChild(makeBall(r.bonus));

      var win = state.result.rank !== '낙첨';
      el.rankBox.classList.toggle('is-win', win);
      el.matchText.textContent = state.result.matches + '개 일치' + (state.result.bonusHit ? ' + 보너스' : '');
      el.rankText.textContent = state.result.rank;

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

  function makeBall(n) {
    var d = document.createElement('div');
    d.className = 'ball ball--38 ' + Lotto.logic.ballClass(n);
    d.textContent = n;
    return d;
  }

  return { init: init };
})();

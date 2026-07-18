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

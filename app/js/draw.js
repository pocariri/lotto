// draw.js — 추첨 탭의 연출 감독. idle → picker → drawing → result 흐름을 관리한다.
// 계산은 전부 Lotto.logic(lottery.js)에 맡기고, 여기서는 화면만 움직인다.

window.Lotto = window.Lotto || {};

Lotto.draw = (function () {
  var state = {
    phase: 'idle',      // 'idle' | 'picker' | 'drawing'
    fixed: [],
    excluded: [],
    drawn: [],
    revealed: 0,
    copied: false
  };

  var el = {};
  var timers = [];      // 공 등장 예약 타이머
  var copyTimer = null;

  // 추첨기 안에서 도는 장식용 공 10개의 색 번호 (디자인 값 그대로)
  var DRUM_COLORS = [3, 14, 22, 34, 42, 7, 18, 27, 39, 45];
  var SPIN_MS = 1500;   // 첫 공이 나오기까지
  var GAP_MS = 780;     // 공과 공 사이 간격

  function init() {
    el.idle = document.getElementById('draw-idle');
    el.picker = document.getElementById('draw-picker');
    el.drawing = document.getElementById('draw-drawing');
    el.grid = document.getElementById('picker-grid');
    el.fixedCount = document.getElementById('fixed-count');
    el.excludedCount = document.getElementById('excluded-count');
    el.notice = document.getElementById('picker-notice');
    el.drum = document.getElementById('drum');
    el.drumSpinner = document.getElementById('drum-spinner');
    el.drumLabel = document.getElementById('drum-label');
    el.resultRow = document.getElementById('result-row');
    el.actions = document.getElementById('draw-actions');
    el.copyBtn = document.getElementById('copy-btn');

    buildGrid();
    buildDrumBalls();

    document.getElementById('go-picker-btn').addEventListener('click', goPicker);
    document.getElementById('reset-btn').addEventListener('click', resetPicks);
    document.getElementById('run-draw-btn').addEventListener('click', runDraw);
    document.getElementById('redraw-btn').addEventListener('click', goPicker);
    el.copyBtn.addEventListener('click', copyNums);

    render();
  }

  // 1~45 버튼 그리드는 한 번만 만들어두고, 상태에 따라 클래스만 바꾼다
  function buildGrid() {
    for (var n = 1; n <= 45; n++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.textContent = n;
      b.addEventListener('click', onCellClick(n));
      el.grid.appendChild(b);
    }
  }
  function onCellClick(n) {
    return function () { cycle(n); };
  }

  // 추첨기 원 둘레에 장식 공 10개 배치 (디자인 좌표 공식 그대로)
  function buildDrumBalls() {
    for (var i = 0; i < 10; i++) {
      var ang = (i / 10) * Math.PI * 2;
      var R = 72;
      var x = 115 + Math.cos(ang) * R - 13;
      var y = 115 + Math.sin(ang) * R - 13;
      var d = document.createElement('div');
      d.className = 'drum-ball ' + Lotto.logic.ballClass(DRUM_COLORS[i]);
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      d.style.animationDelay = (i * 0.06) + 's';
      el.drumSpinner.appendChild(d);
    }
  }

  // ---- 상태 전환 ----

  function goPicker() {
    clearTimers();
    state.phase = 'picker';
    state.drawn = [];
    state.revealed = 0;
    state.copied = false;
    hideNotice();
    render();
  }

  function resetPicks() {
    state.fixed = [];
    state.excluded = [];
    hideNotice();
    renderGrid();
  }

  function cycle(n) {
    var next = Lotto.logic.cycle(state.fixed, state.excluded, n);
    state.fixed = next.fixed;
    state.excluded = next.excluded;
    hideNotice();
    renderGrid();
  }

  function runDraw() {
    var check = Lotto.logic.validate(state.fixed, state.excluded);
    if (!check.ok) {
      el.notice.textContent = check.message;
      el.notice.hidden = false;
      return;
    }
    hideNotice();
    clearTimers();

    state.drawn = Lotto.logic.draw(state.fixed, state.excluded);
    state.revealed = 0;
    state.copied = false;
    state.phase = 'drawing';
    render();

    // 공 6개를 시간차로 하나씩 공개
    for (var i = 1; i <= 6; i++) {
      timers.push(setTimeout(revealTo(i), SPIN_MS + GAP_MS * (i - 1)));
    }
  }
  function revealTo(i) {
    return function () {
      state.revealed = i;
      renderDrawing();
    };
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function hideNotice() {
    el.notice.hidden = true;
  }

  // ---- 결과 동작 ----

  function copyNums() {
    var txt = state.drawn.join(', ');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).catch(function () { fallbackCopy(txt); });
    } else {
      fallbackCopy(txt);
    }
    state.copied = true;
    el.copyBtn.textContent = '복사되었습니다 ✓';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(function () {
      state.copied = false;
      el.copyBtn.textContent = '번호 복사';
    }, 1800);
  }

  // 클립보드 API가 막힌 환경(http 등)용 예비 복사 수단
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 복사 실패해도 앱은 계속 */ }
    ta.remove();
  }

  // ---- 그리기 ----

  function render() {
    el.idle.hidden = state.phase !== 'idle';
    el.picker.hidden = state.phase !== 'picker';
    el.drawing.hidden = state.phase !== 'drawing';
    if (state.phase === 'picker') renderGrid();
    if (state.phase === 'drawing') renderDrawing();
  }

  function renderGrid() {
    var cells = el.grid.children;
    for (var i = 0; i < cells.length; i++) {
      var n = i + 1;
      var cls = 'cell';
      if (state.fixed.indexOf(n) !== -1) cls += ' is-fixed';
      else if (state.excluded.indexOf(n) !== -1) cls += ' is-excluded';
      if (cells[i].className !== cls) cells[i].className = cls;
    }
    el.fixedCount.textContent = '고정 ' + state.fixed.length + '/6';
    el.excludedCount.textContent = '제외 ' + state.excluded.length;
  }

  function renderDrawing() {
    var done = state.revealed >= 6;
    el.drum.classList.toggle('is-spinning', !done);
    el.drumLabel.textContent = done ? 'DONE' : 'DRAW';

    // 이미 공개된 공은 그대로 두고(애니메이션 다시 안 튐), 새 공만 바꾼다
    var slots = el.resultRow.children;
    for (var i = 0; i < 6; i++) {
      var d = slots[i];
      if (i < state.revealed) {
        var n = state.drawn[i];
        var cls = 'ball ball--50 ball--pop ' + Lotto.logic.ballClass(n);
        if (d.className !== cls) {
          d.className = cls;
          d.textContent = n;
        }
      } else if (d.className !== 'result-slot') {
        d.className = 'result-slot';
        d.textContent = '';
      }
    }

    el.actions.hidden = !done;
    el.copyBtn.textContent = state.copied ? '복사되었습니다 ✓' : '번호 복사';
  }

  return { init: init };
})();

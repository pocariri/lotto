// stats.js — 통계 탭. 서버 집계(계약 v1.2)를 그대로 그린다.
// 자주/드문 번호와 홀짝은 서버가 동률 규칙까지 적용해 계산해서 주므로
// 여기서 직접 다시 계산하지 않는다 (직접 계산하면 동률 처리에서 서버와 어긋난다 — 22·32번 동률 실증).

window.Lotto = window.Lotto || {};

Lotto.stats = (function () {
  var el = {};

  async function init() {
    el.status = document.getElementById('stats-status');
    el.content = document.getElementById('stats-content');

    try {
      var data = await Lotto.api.getStats();

      document.getElementById('stats-label').textContent =
        '제 1~' + data.latestRound + '회차 누적 기준';

      renderHotCold(data.mostFrequent, data.leastFrequent);
      renderOddEven(data.oddEven);
      renderFreqRows(data.frequency);

      el.status.hidden = true;
      el.content.hidden = false;
    } catch (e) {
      showStatus(e.message, true);
    }
  }

  function showStatus(msg, isError) {
    el.status.textContent = msg;
    el.status.classList.toggle('status-note--error', !!isError);
    el.status.hidden = false;
  }

  // 자주 나온 3개 / 드물게 나온 3개 — 서버가 준 순서 그대로
  function renderHotCold(most, least) {
    var hotBox = document.getElementById('hot-balls');
    var coldBox = document.getElementById('cold-balls');
    most.forEach(function (o) { hotBox.appendChild(makeBall(o.number)); });
    least.forEach(function (o) { coldBox.appendChild(makeBall(o.number)); });
  }

  // 홀짝 분포 막대 — 서버가 준 개수를 퍼센트로만 바꿔 그린다
  function renderOddEven(oddEven) {
    var total = oddEven.odd + oddEven.even;
    var oddPct = Math.round((oddEven.odd / total) * 100);
    var evenPct = 100 - oddPct;

    var oddEl = document.getElementById('oe-odd');
    var evenEl = document.getElementById('oe-even');
    oddEl.style.width = oddPct + '%';
    oddEl.textContent = '홀 ' + oddPct + '%';
    evenEl.style.width = evenPct + '%';
    evenEl.textContent = '짝 ' + evenPct + '%';
  }

  // 번호별 출현 빈도 45줄 (막대 길이는 최소~최대 사이를 12~100%로 환산 — 디자인 공식)
  function renderFreqRows(frequency) {
    var counts = frequency.map(function (o) { return o.count; });
    var max = Math.max.apply(null, counts);
    var min = Math.min.apply(null, counts);
    var span = (max - min) || 1;

    var list = document.getElementById('freq-list');
    frequency.forEach(function (o) {
      var row = document.createElement('div');
      row.className = 'freq-row';

      var dot = document.createElement('div');
      dot.className = 'freq-dot ' + Lotto.logic.ballClass(o.number);
      dot.textContent = o.number;

      var track = document.createElement('div');
      track.className = 'freq-track';
      var bar = document.createElement('div');
      bar.className = 'freq-bar ' + Lotto.logic.ballClass(o.number);
      bar.style.width = Math.round(((o.count - min) / span) * 88 + 12) + '%';
      track.appendChild(bar);

      var count = document.createElement('span');
      count.className = 'freq-count';
      count.textContent = o.count;

      row.appendChild(dot);
      row.appendChild(track);
      row.appendChild(count);
      list.appendChild(row);
    });
  }

  function makeBall(n) {
    var d = document.createElement('div');
    d.className = 'ball ball--38 ' + Lotto.logic.ballClass(n);
    d.textContent = n;
    return d;
  }

  return { init: init };
})();

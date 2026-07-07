// main.js — 시작점. 하단 탭 전환을 담당하고, 각 화면을 깨운다.
// (script는 defer로 순서대로 실행되므로, 이 파일이 맨 마지막에 돈다)

(function () {
  var TABS = [
    { btn: 'tab-btn-draw', panel: 'tab-draw' },
    { btn: 'tab-btn-check', panel: 'tab-check' },
    { btn: 'tab-btn-stats', panel: 'tab-stats' }
  ];

  function setTab(activeIndex) {
    TABS.forEach(function (t, i) {
      var on = i === activeIndex;
      var btn = document.getElementById(t.btn);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      document.getElementById(t.panel).hidden = !on;
    });
  }

  TABS.forEach(function (t, i) {
    document.getElementById(t.btn).addEventListener('click', function () { setTab(i); });
  });

  async function boot() {
    Lotto.draw.init();

    // 당첨확인·통계는 각자 자기 화면에 로딩/오류를 표시한다
    Lotto.check.init().catch(function (e) { console.error('[check]', e); });
    Lotto.stats.init().catch(function (e) { console.error('[stats]', e); });

    // 상단 바 "제 N회" — 당첨확인 탭이 부른 요청과 같은 캐시를 쓴다 (중복 호출 아님)
    try {
      var latest = await Lotto.api.getDraw();
      document.getElementById('round-label').textContent = '제 ' + latest.round + '회';
    } catch (e) {
      // 라벨은 못 채워도 앱은 동작한다 — 당첨확인 탭이 같은 오류를 사용자에게 보여준다
    }
  }

  boot();
})();

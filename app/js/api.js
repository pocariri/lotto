// api.js — 데이터 창구. api/ 서버 함수에서 실데이터를 받아온다.
// 계약 v1.2 (reports/report-api.md):
//   GET /api/draw          → { ok, data: { round, date "YYYY-MM-DD", numbers[6] 오름차순, bonus,
//                                          firstPrize: { winners, amountPerWinner } } }
//   GET /api/draw?round=N  → 특정 회차, 같은 모양
//   GET /api/stats         → { ok, data: { latestRound, frequency[45]{number,count},
//                                          oddEven{odd,even}, mostFrequent[3], leastFrequent[3] } }
// 실패는 { ok:false, error:{ code, message } } — message는 쉬운 한국어라 그대로 화면에 보여준다.

window.Lotto = window.Lotto || {};

(function () {
  var cache = {}; // 성공한 요청은 다시 안 부른다 (지나간 회차 결과는 안 바뀜)

  function request(url) {
    if (cache[url]) return cache[url];
    var p = fetch(url)
      .then(function (res) { return res.json(); })
      .catch(function () {
        // 네트워크 끊김, 서버 무응답, JSON이 아닌 응답 등
        throw new Error('서버에서 데이터를 받아오지 못했어요. 인터넷 연결을 확인하고 잠시 후 다시 시도해주세요.');
      })
      .then(function (body) {
        if (!body || body.ok !== true) {
          var msg = body && body.error && body.error.message;
          throw new Error(msg || '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해주세요.');
        }
        return body.data;
      });
    cache[url] = p;
    p.catch(function () { delete cache[url]; }); // 실패는 캐싱하지 않는다 — 다시 시도 가능
    return p;
  }

  Lotto.api = {
    // 당첨번호 한 회차. round를 안 주면 최신 회차.
    getDraw: function (round) {
      return request('/api/draw' + (round ? '?round=' + round : ''));
    },

    // 전체 회차 통계
    getStats: function () {
      return request('/api/stats');
    }
  };
})();

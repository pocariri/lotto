// GET /api/stats → 1회차부터 최신 회차까지 전체 집계 (본번호 6개만, 보너스 제외 — 사장 확정)
// 응답 모양: reports/report-api.md 계약 v1.2

const { ok, fail } = require('./_lib/http');
const { getAllDraws } = require('./_lib/draws');
const { UpstreamError } = require('./_lib/dhlottery');

// 통계는 새 회차가 나와야만 바뀌므로 CDN에 1시간 캐싱, 그 뒤 하루까진 이전 값 보여주며 갱신.
const CACHE_STATS = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';

const TOP_COUNT = 3; // 자주/드문 번호 개수 — 사장 확정 (2026-07-07)

function buildStats(latest, draws) {
  const counts = new Array(46).fill(0); // 1~45 사용, 0번 인덱스는 버림
  let odd = 0;
  let even = 0;

  for (const draw of draws) {
    for (const n of draw.numbers) {
      counts[n]++;
      if (n % 2 === 1) odd++;
      else even++;
    }
  }

  const frequency = [];
  for (let n = 1; n <= 45; n++) {
    frequency.push({ number: n, count: counts[n] });
  }

  // 동률이면 번호 낮은 쪽 우선 (계약에 명시된 규칙)
  const byCountDesc = [...frequency].sort((a, b) => b.count - a.count || a.number - b.number);
  const byCountAsc = [...frequency].sort((a, b) => a.count - b.count || a.number - b.number);

  return {
    latestRound: latest,
    frequency,
    oddEven: { odd, even },
    mostFrequent: byCountDesc.slice(0, TOP_COUNT),
    leastFrequent: byCountAsc.slice(0, TOP_COUNT),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'GET으로만 부를 수 있어요.');
  }

  try {
    const { latest, draws } = await getAllDraws();
    return ok(res, buildStats(latest, draws), CACHE_STATS);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return fail(res, 502, 'UPSTREAM_ERROR', '동행복권에서 데이터를 가져오지 못했어요. 잠시 후 다시 시도해주세요.');
    }
    console.error('[api/stats]', err);
    return fail(res, 500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요. 잠시 후 다시 시도해주세요.');
  }
};

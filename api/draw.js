// GET /api/draw          → 최신 회차 당첨번호
// GET /api/draw?round=N  → 특정 회차 당첨번호
// 응답 모양: reports/report-api.md 계약 v1.2

const { ok, fail } = require('./_lib/http');
const { getLatestRound, getDraw } = require('./_lib/draws');
const { UpstreamError } = require('./_lib/dhlottery');

// 지나간 회차는 결과가 안 바뀌므로 CDN에 길게, 최신 회차는 짧게 캐싱.
const CACHE_PAST = 'public, max-age=0, s-maxage=2592000';
const CACHE_LATEST = 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'GET으로만 부를 수 있어요.');
  }

  const { searchParams } = new URL(req.url, 'http://localhost');
  const roundParam = searchParams.get('round');

  try {
    const latest = await getLatestRound();

    if (roundParam === null) {
      const draw = await getDraw(latest);
      if (!draw) throw new UpstreamError('최신 회차 정보를 가져오지 못했어요.');
      return ok(res, draw, CACHE_LATEST);
    }

    if (!/^\d+$/.test(roundParam) || Number(roundParam) < 1) {
      return fail(res, 400, 'INVALID_ROUND', '회차는 1 이상의 숫자여야 해요.');
    }

    const round = Number(roundParam);
    if (round > latest) {
      return fail(res, 404, 'NOT_FOUND', `${round}회는 아직 추첨 전이에요.`);
    }

    const draw = await getDraw(round);
    if (!draw) {
      return fail(res, 404, 'NOT_FOUND', `${round}회 정보를 찾을 수 없어요.`);
    }
    return ok(res, draw, round === latest ? CACHE_LATEST : CACHE_PAST);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return fail(res, 502, 'UPSTREAM_ERROR', '동행복권에서 데이터를 가져오지 못했어요. 잠시 후 다시 시도해주세요.');
    }
    console.error('[api/draw]', err);
    return fail(res, 500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요. 잠시 후 다시 시도해주세요.');
  }
};

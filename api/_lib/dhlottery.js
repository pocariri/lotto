// 동행복권 연동 (2026 개편 사이트 기준)
//
// 엔드포인트: GET /lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=<회차>
//  - 요청 회차를 중심으로 최대 10개 회차 묶음을 돌려준다 (대략 [회차-5, 회차+4], 경계에서 안쪽으로 밀림).
//  - 존재하지 않는 회차(아직 추첨 전 포함)를 중심으로 잡으면 빈 목록이 온다.
//  - 예전 공개 API(common.do?method=getLottoNumber)는 2026 개편으로 사라졌음. 이 주소가 현재 결과 페이지가 쓰는 것.

const BASE_URL = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do';

// 브라우저처럼 보이지 않으면 일부 경로가 첫 화면으로 돌려보내서 UA를 붙인다.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 최신 회차 추정 앵커: 1178회 결과가 2025-06-28(토) 저녁에 공개됨. 추첨은 매주 토요일 1회 고정.
const ANCHOR_ROUND = 1178;
const ANCHOR_MS = Date.parse('2025-06-28T21:30:00+09:00');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

class UpstreamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UpstreamError';
  }
}

// 동행복권 원본 한 건 → 계약 v1.2의 draw 모양으로 변환. 이상한 데이터면 던진다.
function toDraw(raw) {
  const round = Number(raw.ltEpsd);
  const numbers = [raw.tm1WnNo, raw.tm2WnNo, raw.tm3WnNo, raw.tm4WnNo, raw.tm5WnNo, raw.tm6WnNo].map(Number);
  const bonus = Number(raw.bnsWnNo);
  const ymd = String(raw.ltRflYmd || '');

  const validNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 45;
  const valid =
    Number.isInteger(round) && round >= 1 &&
    numbers.every(validNumber) && new Set(numbers).size === 6 &&
    validNumber(bonus) && /^\d{8}$/.test(ymd);
  if (!valid) {
    throw new UpstreamError(`동행복권 응답의 ${raw.ltEpsd}회 데이터 모양이 예상과 달라요.`);
  }

  numbers.sort((a, b) => a - b);
  return {
    round,
    date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
    numbers,
    bonus,
    firstPrize: {
      winners: Number(raw.rnk1WnNope) || 0,
      amountPerWinner: Number(raw.rnk1WnAmt) || 0,
    },
  };
}

// 회차 하나를 중심으로 한 묶음(최대 10회차)을 가져온다. 실패 시 1회 재시도 후 UpstreamError.
async function fetchWindow(centerRound) {
  const url = `${BASE_URL}?srchDir=center&srchLtEpsd=${centerRound}`;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new UpstreamError(`동행복권이 ${res.status} 응답을 보냈어요.`);
      const body = await res.json();
      const list = (body && body.data && body.data.list) || [];
      return list.map(toDraw);
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw lastError instanceof UpstreamError
    ? lastError
    : new UpstreamError(`동행복권에 연결하지 못했어요. (${lastError && lastError.message})`);
}

// 오늘 날짜 기준으로 최신 회차를 추정한다 (실제와 최대 ±1 차이).
function estimateLatestRound(nowMs = Date.now()) {
  return ANCHOR_ROUND + Math.floor((nowMs - ANCHOR_MS) / WEEK_MS);
}

// 최신 회차를 실제로 확인한다. 추정치보다 2 낮은 회차를 중심으로 조회하면
// 묶음의 위쪽 여유(+4) 안에 진짜 최신 회차가 들어오므로, 돌아온 것 중 최대가 최신이다.
async function findLatestRound() {
  const estimate = estimateLatestRound();
  const candidates = [estimate - 2, estimate - 6, estimate - 10].map((c) => Math.max(1, c));
  for (const candidate of candidates) {
    const draws = await fetchWindow(candidate);
    if (draws.length > 0) return Math.max(...draws.map((d) => d.round));
  }
  throw new UpstreamError('동행복권에서 최신 회차를 확인하지 못했어요.');
}

module.exports = { fetchWindow, findLatestRound, estimateLatestRound, UpstreamError };

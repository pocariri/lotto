// 회차 데이터 저장고 — 스냅샷(과거 회차, 파일) + 실시간(스냅샷 이후 회차, 동행복권) 병합.
//
// 지나간 회차는 결과가 절대 안 바뀌므로 저장소(_data/draws-snapshot.json)에 박아두고,
// 스냅샷 이후에 새로 나온 회차만 요청 시 동행복권에서 받아와 메모리에 캐싱한다.
// 스냅샷 갱신은 `node api/_scripts/build-snapshot.js` (아무 때나 다시 돌려도 안전).

const { fetchWindow, findLatestRound } = require('./dhlottery');
const snapshot = require('../_data/draws-snapshot.json');

const byRound = new Map(snapshot.map((d) => [d.round, d]));
const snapshotMax = snapshot.length > 0 ? snapshot[snapshot.length - 1].round : 0;

// 최신 회차 번호는 10분 캐싱 (새 회차는 일주일에 하나만 나오니 충분히 신선함).
const LATEST_TTL_MS = 10 * 60 * 1000;
let latestCache = { round: 0, checkedAt: 0 };

async function getLatestRound() {
  const now = Date.now();
  if (latestCache.round > 0 && now - latestCache.checkedAt < LATEST_TTL_MS) {
    return latestCache.round;
  }
  const round = await findLatestRound();
  latestCache = { round, checkedAt: now };
  return round;
}

// 특정 회차 하나. 스냅샷/메모리에 없으면 동행복권에서 그 주변 묶음을 받아와 같이 캐싱한다.
// 존재하지 않는 회차면 null.
async function getDraw(round) {
  if (byRound.has(round)) return byRound.get(round);
  const draws = await fetchWindow(round);
  for (const d of draws) {
    if (!byRound.has(d.round)) byRound.set(d.round, d);
  }
  return byRound.get(round) || null;
}

// 1회차부터 최신 회차까지 전부. 스냅샷 이후 빠진 회차만 묶음 단위로 받아온다.
async function getAllDraws() {
  const latest = await getLatestRound();
  let round = snapshotMax + 1;
  while (round <= latest) {
    if (byRound.has(round)) {
      round++;
      continue;
    }
    // 묶음이 [중심-5, 중심+4]라서 중심을 +5로 잡으면 [round, round+9]를 덮는다.
    // 단, 중심이 최신 회차를 넘으면 빈 목록이 오므로 최신 회차로 낮춘다.
    const draws = await fetchWindow(Math.min(round + 5, latest));
    let maxFetched = 0;
    for (const d of draws) {
      if (!byRound.has(d.round)) byRound.set(d.round, d);
      if (d.round > maxFetched) maxFetched = d.round;
    }
    round = Math.max(maxFetched, round) + 1;
  }

  const all = [];
  for (let round = 1; round <= latest; round++) {
    const d = byRound.get(round);
    if (d) all.push(d);
  }
  return { latest, draws: all };
}

module.exports = { getLatestRound, getDraw, getAllDraws, snapshotMax };

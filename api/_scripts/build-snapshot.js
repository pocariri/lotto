// 전 회차 스냅샷 생성 스크립트 (로컬에서 실행 — 서버에서 돌지 않음)
//
//   node api/_scripts/build-snapshot.js
//
// 동행복권에서 1회차부터 최신 회차까지 받아 _data/draws-snapshot.json 을 만든다.
// 10회차 묶음 API를 쓰므로 요청 수는 회차 수의 1/10 수준이고, 요청 사이에 쉬어서 예의를 지킨다.
// 지나간 회차는 결과가 안 바뀌므로 가끔(예: 배포 전에 한 번) 다시 돌려 최신화하면 된다.

const fs = require('fs');
const path = require('path');
const { fetchWindow, findLatestRound } = require('../_lib/dhlottery');

const OUT_PATH = path.join(__dirname, '..', '_data', 'draws-snapshot.json');
const DELAY_MS = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const latest = await findLatestRound();
  console.log(`최신 회차: ${latest}회. 1회부터 받아옵니다.`);

  const byRound = new Map();
  let round = 1;
  let requests = 0;

  while (round <= latest) {
    if (byRound.has(round)) {
      round++;
      continue;
    }
    const center = Math.min(round + 5, latest);
    const draws = await fetchWindow(center);
    requests++;
    let maxFetched = 0;
    for (const d of draws) {
      byRound.set(d.round, d);
      if (d.round > maxFetched) maxFetched = d.round;
    }
    if (maxFetched < round) {
      throw new Error(`${round}회 근처를 요청했는데 새 데이터가 없어요. 중단합니다.`);
    }
    round = maxFetched + 1;
    if (requests % 10 === 0) console.log(`  ...${Math.min(round - 1, latest)}회까지 (요청 ${requests}번)`);
    await sleep(DELAY_MS);
  }

  // 검증: 1..latest 빠짐없이, 모양도 계약대로인지
  const missing = [];
  for (let r = 1; r <= latest; r++) {
    if (!byRound.has(r)) missing.push(r);
  }
  if (missing.length > 0) {
    throw new Error(`빠진 회차가 있어요: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' ...' : ''}`);
  }

  const all = Array.from(byRound.values()).sort((a, b) => a.round - b.round);

  // 한 회차 = 한 줄로 저장 (사람이 눈으로 확인하기 좋게)
  const lines = all.map((d) => '  ' + JSON.stringify(d));
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, '[\n' + lines.join(',\n') + '\n]\n');

  console.log(`완료: ${all.length}개 회차, 요청 ${requests}번 → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('실패:', err.message);
  process.exit(1);
});

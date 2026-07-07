// 응답 겉봉투 헬퍼 — 계약 v1.2 (reports/report-api.md)
// 성공: { ok: true, data }  /  실패: { ok: false, error: { code, message } }

function send(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 같은 도메인 배포라 CORS 불필요하지만, 로컬 개발(다른 포트) 편의용. 공개 읽기 전용 데이터.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', cacheControl || 'no-store');
  res.end(JSON.stringify(body));
}

function ok(res, data, cacheControl) {
  send(res, 200, { ok: true, data }, cacheControl);
}

function fail(res, status, code, message) {
  send(res, status, { ok: false, error: { code, message } });
}

module.exports = { ok, fail };

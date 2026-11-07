// local-server.js — 로컬 확인용 서버.
// app/ 정적 파일과 api/ 서버 함수(../../api)를 Vercel처럼 한 포트에 물린다.
// 사용: node app/test/local-server.js [포트]   (기본 8899)

const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
const drawHandler = require(path.join(APP_DIR, '..', 'api', 'draw.js'));
const statsHandler = require(path.join(APP_DIR, '..', 'api', 'stats.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://localhost');

  // api/ 서버 함수 (Vercel과 같은 (req, res) 모양이라 그대로 부른다)
  try {
    if (url.pathname === '/api/draw') return await drawHandler(req, res);
    if (url.pathname === '/api/stats') return await statsHandler(req, res);
  } catch (e) {
    console.error('[local-server]', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: '로컬 서버에서 문제가 생겼어요.' } }));
  }

  // app/ 정적 파일
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(APP_DIR, rel));
  if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.argv[2]) || 8899;
server.listen(port, function () {
  console.log('로컬 서버 시작: http://localhost:' + port + '  (정적: app/, 함수: /api/draw, /api/stats)');
});

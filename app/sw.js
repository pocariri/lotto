// sw.js — 서비스 워커 (PWA: 홈 화면 앱 + 인터넷 끊겨도 화면은 열리게).
//
// 원칙 (2026-11-07):
//  1) 화면 파일(html/css/js/아이콘)은 "네트워크 먼저" — 인터넷 되면 항상 최신 파일, 끊기면 저장본.
//     그래서 배포하면 다음 실행부터 바로 새 화면이 나온다 (옛 화면에 갇히는 일 없음).
//  2) /api/ (당첨 데이터)는 절대 가로채지 않는다 — 서버·CDN 캐싱 설계("항상 최신")를 그대로 둔다.
//     오프라인이면 당첨확인·통계는 원래 있던 오류 안내가 뜨고, 추첨 탭은 그대로 동작한다.
//  3) 폰트(jsDelivr, 버전 고정 주소)는 내용이 안 바뀌므로 "저장본 먼저".
// 화면 파일 목록이 바뀌면 SHELL을 고치고 VERSION을 올린다 (옛 저장본은 자동 삭제).

var VERSION = 'v1';
var CACHE = 'lotto-shell-' + VERSION;
var FONT_CACHE = 'lotto-font-v1';

var SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/components.css',
  'css/draw.css',
  'css/check.css',
  'css/stats.css',
  'js/vendor/jsqr.min.js',
  'js/lottery.js',
  'js/api.js',
  'js/draw.js',
  'js/qr-scan.js',
  'js/check.js',
  'js/stats.js',
  'js/main.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE && k !== FONT_CACHE) return caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function networkFirst(request) {
  return fetch(request)
    .then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return res;
    })
    .catch(function () {
      return caches.match(request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        // 처음 보는 주소로 앱을 열었는데 오프라인이면 메인 화면이라도 보여준다
        if (request.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    });
}

function cacheFirst(request) {
  return caches.open(FONT_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf('/api/') === 0) return; // 원칙 2: 데이터는 손대지 않음
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.hostname === 'fastly.jsdelivr.net' && url.pathname.indexOf('/gh/orioncactus/pretendard@') === 0) {
    event.respondWith(cacheFirst(request));
  }
  // 그 밖의 외부 주소(동행복권 이동 등)는 브라우저 기본 동작
});

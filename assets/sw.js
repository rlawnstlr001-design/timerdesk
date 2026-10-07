/* TimerDesk 서비스 워커 — 홈 화면 앱(PWA)·오프라인 사용
   - 페이지(HTML): 네트워크 우선 → 실패(오프라인)하면 저장해 둔 페이지, 그것도 없으면 그 언어 첫 화면
   - /assets/·/icons/: 캐시 우선 (파일 주소에 ?v=버전이 붙어 내용이 바뀌면 새로 받는다)
   - 다른 도메인(서버시간 중계·GA·애드센스)과 GET이 아닌 요청은 손대지 않는다
   빌드할 때 __VERSION__이 자산 버전 해시로 바뀐다 → 배포마다 옛 캐시를 지운다 */
var CACHE = "td-__VERSION__";

self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("td-") === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        var lang = url.pathname.split("/")[1] || "en";
        return caches.match("/" + lang + "/").then(function (home) { return home || Response.error(); });
      });
    }));
    return;
  }

  if (url.pathname.indexOf("/assets/") === 0 || url.pathname.indexOf("/icons/") === 0) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    }));
  }
});

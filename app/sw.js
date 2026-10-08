/* 설교 자막 앱 서비스 워커 (원점 https://jacobkrystal.github.io, 범위 /app/ 만).
   앱 틀(화면·스크립트·아이콘)만 저장한다. 자막은 WebSocket 으로 오므로 저장되지 않고,
   터널 주소를 담은 url.json 은 어떤 경우에도 저장하지 않는다(항상 네트워크).
   화면은 네트워크 우선(3초) — 인터넷이 되면 항상 최신 화면, 안 되면 저장된 틀을 보여 주고 그 틀이 스스로 재접속한다. */
var VERSION = "app-v1";
var CACHE = "sermon-app-" + VERSION;
var SCOPE = self.registration.scope;                       /* https://…/app/ */
var SHELL = ["./", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
var NAV_TIMEOUT_MS = 3000;

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL.map(function (u) { return new Request(new URL(u, SCOPE).href, { cache: "reload" }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf("sermon-app-") === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
function timeout(ms) { return new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); }); }

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.slice(-9) === "/url.json") return;      /* 터널 주소는 절대 저장하지 않음 */
  if (url.pathname.indexOf("/app/") !== 0) return;         /* 범위 밖(기존 QR 페이지 등)은 건드리지 않음 */
  var shellKey = new URL("./", SCOPE).href;

  if (req.mode === "navigate") {
    e.respondWith(
      Promise.race([fetch(req), timeout(NAV_TIMEOUT_MS)]).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(shellKey, copy); }); }
        return res;
      }).catch(function () {
        return caches.match(shellKey).then(function (hit) {
          return hit || new Response("offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        var rel = url.pathname.slice("/app/".length);
        if (res && res.ok && SHELL.indexOf(rel) >= 0) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

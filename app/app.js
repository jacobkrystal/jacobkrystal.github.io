/* 설교 자막 앱 (고정 원점 https://jacobkrystal.github.io/app/) — 보조 스크립트.
   ① 터널 주소 해석: ../url.json(항상 새로 읽음, 캐시 금지) → 현재 터널의 wss://…/ws
   ② 서비스 워커 등록 ③ 홈 화면 추가 안내 배너 ④ 화면 복귀 시 재접속 깨우기.
   청중 화면(index.html)은 기존 청중 페이지의 사본이고, 연결 후보 주소만 이 파일이 준 터널로 바뀐다. */
(function () {
  "use strict";
  function log() { try { console.log.apply(console, ["[app]"].concat([].slice.call(arguments))); } catch (e) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var W = (window.__app = { tunnel: "", ws: "", urlJsonAt: 0, urlJsonOk: false, sw: "idle", scope: "", banner: "none", installPrompt: false, standalone: false, refreshes: 0 });

  /* ① 터널 주소 해석 */
  var URLJSON = new URL("../url.json", location.href).href;       /* /app/ → /url.json (같은 원점) */
  var LAST_KEY = "app.lastTunnel";
  var MIN_GAP_MS = 4000;                                           /* 재조회 폭주 방지 */
  var inflight = null;

  function toWs(u) {
    var x;
    try { x = new URL(u); } catch (e) { return ""; }
    var local = x.hostname === "127.0.0.1" || x.hostname === "localhost";
    if (x.protocol === "https:") return "wss://" + x.host + "/ws";
    if (x.protocol === "http:" && local) return "ws://" + x.host + "/ws";   /* 시험 전용: 로컬만 비보안 허용 */
    return "";
  }
  function apply(u, fromNet) {
    var ws = toWs(u);
    if (!ws) return false;
    W.tunnel = u.replace(/\/+$/, ""); W.ws = ws; window.__tunnelWs = ws;
    if (fromNet) lsSet(LAST_KEY, W.tunnel);
    return true;
  }
  window.__refreshTunnel = function () {
    var now = Date.now();
    if (inflight) return inflight;
    if (W.urlJsonOk && now - W.urlJsonAt < MIN_GAP_MS) return Promise.resolve();
    W.urlJsonAt = now;
    inflight = fetch(URLJSON + "?t=" + now, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("url.json HTTP " + r.status); return r.json(); })
      .then(function (d) {
        if (!d || !d.url || !apply(String(d.url), true)) throw new Error("url.json 형식 오류");
        W.urlJsonOk = true; W.refreshes++;
        log("tunnel=" + W.tunnel);
      })
      .catch(function (err) {
        W.urlJsonOk = false;
        log("url.json 조회 실패: " + (err && err.message));
        if (!window.__tunnelWs) {                                   /* 마지막으로 성공한 주소로라도 시도 */
          var last = lsGet(LAST_KEY);
          if (last && apply(last, false)) log("마지막 성공 주소 사용 " + last);
        }
      })
      .then(function () { inflight = null; });
    return inflight;
  };
  window.__refreshTunnel();                                         /* 미리 한 번 */

  /* ② 서비스 워커 */
  var standalone = false;
  try {
    standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
                 window.navigator.standalone === true;
  } catch (e) {}
  W.standalone = standalone;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { scope: "./" }).then(function (reg) {
      W.sw = "registered"; W.scope = reg.scope; log("service worker registered scope=" + reg.scope);
      return navigator.serviceWorker.ready;
    }).then(function (reg) { W.sw = "ready"; log("service worker ready active=" + !!(reg && reg.active)); })
      .catch(function (err) { W.sw = "failed: " + (err && err.message); log("service worker FAILED: " + (err && err.message)); });
  } else { W.sw = "unsupported"; }

  /* ③ 안내 배너 */
  var Q = new URLSearchParams(location.search);
  function pickLang() {
    var l = Q.get("lang");
    if (!l) { try { l = JSON.parse(lsGet("cap.lang")); } catch (e) { l = null; } }
    if (!l) l = (navigator.language || "en").slice(0, 2);
    return /^(ko|en|tl)$/.test(l) ? l : "en";
  }
  var TXT = {
    ko: { install: "홈 화면에 추가하면 아이콘으로 바로 열려요", btn: "설치", close: "닫기",
          ios: "아래 공유 버튼(□↑) → ‘홈 화면에 추가’. (iPhone은 화면이 저절로 꺼지면 Safari 탭으로 보세요)" },
    en: { install: "Add to Home Screen to open with one tap", btn: "Install", close: "Close",
          ios: "Tap Share (□↑) → ‘Add to Home Screen’. (On iPhone, if the screen turns off, use a Safari tab)" },
    tl: { install: "Idagdag sa Home Screen para mabuksan agad", btn: "I-install", close: "Isara",
          ios: "Pindutin ang Share (□↑) → ‘Add to Home Screen’. (Sa iPhone, kung namamatay ang screen, gamitin ang Safari tab)" }
  };
  var DISMISS_KEY = "app.banner.dismissed";
  var deferred = null;
  function liveVisible() { var l = document.getElementById("live"); return !!l && !l.classList.contains("hide"); }
  function removeBanner() { var b = document.getElementById("appBanner"); if (b) b.remove(); W.banner = "none"; }
  function dismissedRecently() { var v = parseInt(lsGet(DISMISS_KEY) || "0", 10); return v && (Date.now() - v) < 7 * 24 * 3600 * 1000; }
  function mkBanner(text, withBtn) {
    if (document.getElementById("appBanner")) return;
    var L = TXT[pickLang()];
    var d = document.createElement("div");
    d.id = "appBanner"; d.setAttribute("role", "region"); d.setAttribute("aria-label", L.btn);
    d.style.cssText = "position:fixed;left:12px;right:12px;top:calc(8px + env(safe-area-inset-top));z-index:90;" +
      "display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:#1E2540;color:#fff;" +
      "font:600 13px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(11,18,32,.28)";
    var t = document.createElement("span"); t.style.flex = "1 1 auto"; t.textContent = text; d.appendChild(t);
    if (withBtn) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = L.btn;
      b.style.cssText = "height:32px;padding:0 14px;border-radius:999px;background:#6366F1;color:#fff;font:700 13px system-ui;border:0";
      b.addEventListener("click", function () {
        if (!deferred) return;
        deferred.prompt();
        deferred.userChoice.then(function (c) { log("install choice=" + c.outcome); removeBanner(); });
        deferred = null;
      });
      d.appendChild(b);
    }
    var x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.setAttribute("aria-label", L.close);
    x.style.cssText = "width:32px;height:32px;border-radius:999px;background:transparent;color:#C7CDDA;font:700 15px system-ui;border:0";
    x.addEventListener("click", function () { lsSet(DISMISS_KEY, String(Date.now())); removeBanner(); });
    d.appendChild(x);
    document.body.appendChild(d);
    W.banner = withBtn ? "install" : "ios";
  }
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferred = e; W.installPrompt = true; log("beforeinstallprompt captured");
    if (!standalone && !dismissedRecently() && !liveVisible()) mkBanner(TXT[pickLang()].install, true);
  });
  window.addEventListener("appinstalled", function () { log("appinstalled"); removeBanner(); });
  var ua = navigator.userAgent || "";
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  document.addEventListener("DOMContentLoaded", function () {
    if (isIOS && !standalone && !dismissedRecently() && !liveVisible()) mkBanner(TXT[pickLang()].ios, false);
    var live = document.getElementById("live");
    if (live && window.MutationObserver) {
      new MutationObserver(function () { if (liveVisible()) removeBanner(); })
        .observe(live, { attributes: true, attributeFilter: ["class"] });
    }
  });

  /* ④ 앱 전환·뒤로가기로 되살아날 때 기존 재접속 로직 깨우기 */
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) { window.__refreshTunnel().then(function () { window.dispatchEvent(new Event("online")); }); }
  });
})();

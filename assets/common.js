/* 공통 유틸: 저장 · 소리 · 전체화면 · 화면 꺼짐 방지 · 알림 · 카운트다운 엔진
   모든 도구 스크립트는 이 파일 다음에 로드되며 window.TD 를 통해서만 공유한다. */
window.TD = window.TD || {};
(function (TD) {
  "use strict";

  var I = window.TD_I18N || { lang: "en", ui: {}, t: {} };
  TD.i18n = I;
  TD.lang = I.lang || document.documentElement.lang || "en";
  TD.$ = function (s, r) { return (r || document).querySelector(s); };
  TD.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  TD.pad = pad;
  // 남은 초 -> "mm:ss" / "h:mm:ss" (올림: 시작 직후 25:00 이 1초간 보이도록)
  TD.fmt = function (sec) {
    sec = Math.max(0, Math.ceil(sec - 1e-6));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
  };
  TD.dateKey = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  TD.clock = function (ms, withSec) {
    // ui.clock24: 한국어 등은 "오전 8:40" 대신 "08:40"
    var o = I.ui.clock24 ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : { hour: "numeric", minute: "2-digit" };
    if (withSec) o.second = "2-digit";
    return new Intl.DateTimeFormat(TD.lang, o).format(new Date(ms));
  };

  TD.load = function (k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  };
  TD.save = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 무시 */ } };

  /* ---------- 소리 (Web Audio 합성 — 외부 음원 파일 없음) ---------- */
  var ctx = null;
  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  TD.unlockAudio = function () { try { audio(); } catch (e) { /* 미지원 */ } };
  document.addEventListener("pointerdown", TD.unlockAudio, { once: true });

  function tone(c, out, f, t, dur, type, peak) {
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  var SOUNDS = {
    bell: { len: 1.6, play: function (c, o, t) { tone(c, o, 880, t, 1.5, "sine", 0.5); tone(c, o, 1760, t, 0.9, "sine", 0.18); tone(c, o, 2640, t, 0.5, "sine", 0.08); } },
    chime: { len: 1.5, play: function (c, o, t) { tone(c, o, 784, t, 0.9, "sine", 0.5); tone(c, o, 523.25, t + 0.45, 1.0, "sine", 0.5); } },
    beep: { len: 0.7, play: function (c, o, t) { [0, 0.2, 0.4].forEach(function (d) { tone(c, o, 880, t + d, 0.14, "square", 0.14); }); } },
    digital: { len: 0.9, play: function (c, o, t) { [0, 0.12, 0.24, 0.36].forEach(function (d) { tone(c, o, 1250, t + d, 0.08, "square", 0.14); }); } }
  };
  TD.SOUND_KEYS = Object.keys(SOUNDS);
  // delay(초)를 주면 오디오 시계로 예약 재생 — JS 타이머가 늦어져도 정확한 순간에 울린다.
  // 반환값(out)을 out.disconnect() 하면 예약을 취소할 수 있다.
  TD.play = function (name, volume, times, delay) {
    var c;
    try { c = audio(); } catch (e) { return null; }
    if (!c) return null;
    var s = SOUNDS[name] || SOUNDS.bell, out = c.createGain();
    out.gain.value = volume == null ? 0.7 : volume;
    out.connect(c.destination);
    var t = c.currentTime + Math.max(0.03, delay || 0);
    for (var i = 0; i < (times || 1); i++) s.play(c, out, t + i * (s.len + 0.25));
    return out;
  };
  TD.fillSoundSelect = function (sel, current) {
    var names = I.ui.soundNames || {};
    sel.innerHTML = TD.SOUND_KEYS.map(function (k) { return '<option value="' + k + '">' + (names[k] || k) + "</option>"; }).join("");
    sel.value = current;
  };

  /* ---------- 전체화면 (iPhone 등 미지원 기기는 화면 채우기로 대체) ---------- */
  TD.toggleFullscreen = function (el) {
    var d = document;
    if (el.classList.contains("pseudo-fs")) { el.classList.remove("pseudo-fs"); return; }
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el); else el.classList.add("pseudo-fs");
  };

  /* ---------- 실행 중 화면 꺼짐 방지 ---------- */
  var lock = null, wantLock = false;
  function acquire() {
    if (!wantLock || lock || !("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (l) {
      lock = l;
      l.addEventListener("release", function () { lock = null; });
    }).catch(function () { /* 거부·미지원 무시 */ });
  }
  TD.keepAwake = function (on) {
    wantLock = !!on;
    if (on) acquire();
    else if (lock) { lock.release(); lock = null; }
  };
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") acquire(); });

  /* ---------- 탭 제목에 남은 시간 표시 ---------- */
  var baseTitle = document.title;
  TD.setTitle = function (prefix) { document.title = prefix ? prefix + " · " + baseTitle : baseTitle; };

  /* ---------- 브라우저 알림 (다른 탭을 보고 있을 때만) ---------- */
  TD.askNotify = function () {
    if ("Notification" in window && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (e) { /* 무시 */ }
    }
  };
  TD.notify = function (title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    try { new Notification(title, { body: body, icon: "/favicon.svg" }); } catch (e) { /* 모바일 크롬 등 */ }
  };

  /* ---------- 사용 이벤트 (GA4가 있을 때만) ---------- */
  TD.track = function (name, params) {
    try { if (window.gtag) window.gtag("event", name, Object.assign({ tool: location.pathname.split("/")[2] || "home", lang: TD.lang }, params || {})); } catch (e) { /* 무시 */ }
  };

  /* ---------- 단축키 (입력창에서는 무시) ---------- */
  TD.keys = function (map) {
    document.addEventListener("keydown", function (e) {
      var tg = e.target;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      var fn = map[e.code];
      if (fn) { e.preventDefault(); fn(); }
    });
  };

  /* ---------- 카운트다운 엔진 ----------
     종료 시각(endAt) 기준으로 계산하므로 백그라운드 탭에서 타이머가 느려져도 오차가 쌓이지 않는다.
     종료 순간은 별도 1회성 setTimeout 으로 잡는다 (반복 타이머보다 덜 지연됨). */
  TD.Countdown = function (opts) {
    var self = this;
    this.onTick = opts.onTick || function () {};
    this.onDone = opts.onDone || function () {};
    this.total = 0; this.left = 0; this.endAt = 0; this.running = false;
    this._iv = null; this._to = null;
    document.addEventListener("visibilitychange", function () { if (self.running) self._tick(); });
  };
  var CP = TD.Countdown.prototype;
  CP.remaining = function () { return this.running ? Math.max(0, (this.endAt - Date.now()) / 1000) : this.left; };
  CP.set = function (sec) { this._clear(); this.running = false; this.total = this.left = sec; this.onTick(sec); };
  CP.start = function () {
    if (this.running || this.left <= 0) return;
    var self = this;
    this.running = true;
    if (this.left === this.total) TD.track("timer_start", { seconds: Math.round(this.total) }); // 처음 시작할 때만 (재개 제외)
    this.endAt = Date.now() + this.left * 1000;
    this._iv = setInterval(function () { self._tick(); }, 250);
    this._to = setTimeout(function () { self._tick(); }, this.left * 1000 + 30);
    this._tick();
  };
  CP.pause = function () {
    if (!this.running) return;
    this.left = this.remaining();
    this.running = false;
    this._clear();
    this.onTick(this.left);
  };
  CP._clear = function () { clearInterval(this._iv); clearTimeout(this._to); };
  CP._tick = function () {
    var r = this.remaining();
    if (this.running && r <= 0) {
      this.running = false; this.left = 0; this._clear();
      this.onTick(0); this.onDone();
      return;
    }
    this.onTick(r);
  };

  /* ---------- 홈 화면 앱(PWA) ---------- */
  // 서비스 워커: 오프라인에서도 열리게. 설치 버튼은 브라우저가 설치 가능하다고 알릴 때만(안드로이드·PC 크롬) 보인다
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }
  var installEvt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installEvt = e;
    var b = document.getElementById("tdInstall");
    if (b) b.hidden = false;
  });
  document.addEventListener("click", function (e) {
    if (!installEvt || !e.target.closest("#tdInstall")) return;
    installEvt.prompt();
    installEvt.userChoice.then(function (c) { TD.track("pwa_install", { outcome: c.outcome }); });
    installEvt = null;
    e.target.closest("#tdInstall").hidden = true;
  });
  window.addEventListener("appinstalled", function () { TD.track("pwa_installed"); });
})(window.TD);

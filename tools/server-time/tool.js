/* 서버시간: 중계 서버(Cloudflare Worker)로 ① 기기 시계 ↔ 표준시(엣지) 차이, ② 대상 사이트 서버 ↔ 엣지 차이를 재서
   서버 시각 = 기기 시각 + ① + ② 로 0.1초 단위 표시. 알림은 오디오 시계로 미리 예약해 백그라운드에서도 정확하게 울린다. */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, $ = TD.$, pad = TD.pad;
  var API = (window.TD_TIME_API || "").replace(/\/$/, "");
  var root = $("#tool");
  var SITES = window.TD_SRV_CHIPS || T.sites; // [{label, url}] — 대학 수강신청 페이지는 대학 목록
  var PAGE_SITE = window.TD_SRV_SITE || null;  // 사이트별 페이지(/server-time/interpark/ 등)면 그 사이트
  var PAGES = window.TD_SRV_PAGES || {};       // 사이트 주소 → 전용 페이지 경로
  var st = { url: "", label: T.standard, dev: 0, devErr: null, srv: 0, srvErr: 0, measuredAt: 0, ok: false, error: "" };
  var alarm = { at: null, scheduled: null, fired: false };
  var lastTenth = -1;

  function serverNow() { return Date.now() + st.dev + st.srv; }

  /* ---------- 측정 ---------- */
  function getJSON(path) {
    return fetch(API + path, { cache: "no-store" }).then(function (r) { return r.json(); });
  }
  // 기기 ↔ 엣지: 5번 재서 왕복이 가장 짧은 표본을 쓴다
  function syncDevice() {
    var best = null, i = 0;
    function once() {
      var t0 = Date.now();
      return getJSON("/now").then(function (j) {
        var t1 = Date.now(), rtt = t1 - t0;
        if (!best || rtt < best.rtt) best = { rtt: rtt, off: j.now - (t0 + t1) / 2 };
        if (++i < 5) return once();
      });
    }
    return once().then(function () { st.dev = best.off; st.devErr = Math.round(best.rtt / 2); });
  }
  function measureServer() {
    if (!st.url) { st.srv = 0; st.srvErr = 0; st.ok = true; st.error = ""; st.measuredAt = Date.now(); render(); return Promise.resolve(); }
    var url = st.url;
    return getJSON("/server?url=" + encodeURIComponent(url)).then(function (j) {
      if (url !== st.url) return; // 그사이 대상이 바뀌었으면 버린다
      if (j.error) { st.ok = false; st.error = T.errors[j.error] || T.errors["fetch-failed"]; }
      else { st.ok = true; st.error = ""; st.srv = j.offset; st.srvErr = j.err; st.measuredAt = Date.now(); }
      reschedule(); render();
    }).catch(function () { st.ok = false; st.error = T.errors["fetch-failed"]; render(); });
  }

  function setTarget(url, label) {
    st.url = url; st.label = label || url || T.standard;
    st.ok = false; st.error = ""; st.srv = 0;
    $("#srvUrl").value = url;
    TD.save("srv-last", { url: url, label: st.label });
    TD.$$(".chip", $("#srvSites")).forEach(function (b) { b.classList.toggle("on", b.dataset.url === url); });
    // 사이트별 페이지에서 그 페이지 사이트를 보면 주소에 ?site=를 붙이지 않는다
    var keepClean = !url || (PAGE_SITE && PAGE_SITE.url === url);
    try { history.replaceState(null, "", keepClean ? location.pathname : location.pathname + "?site=" + encodeURIComponent(url)); } catch (e) { /* 무시 */ }
    $("#srvMeta").textContent = T.syncing;
    measureServer();
    TD.track("server_time", { site: url || "standard" });
  }

  /* ---------- 표시 ---------- */
  var dateFmt = new Intl.DateTimeFormat(TD.lang, { dateStyle: "full" });
  function render() {
    $("#srvTarget").textContent = st.url ? T.serverOf.replace("{site}", st.label) : T.standard;
    if (st.error) { $("#srvMeta").textContent = "⚠ " + st.error; root.classList.add("err"); return; }
    root.classList.remove("err");
    if (!st.ok) return;
    var diff = (st.dev + st.srv) / 1000, abs = Math.abs(diff).toFixed(2);
    var rel = Math.abs(diff) < 0.05 ? T.same : (diff > 0 ? T.ahead : T.behind).replace("{s}", abs);
    var err = (st.srvErr || 0) + (st.devErr || 0); // 기기↔표준시 + 표준시↔서버 오차의 합
    $("#srvMeta").textContent = rel + " · " + T.accuracy.replace("{ms}", err);
  }
  function frame() {
    var now = serverNow(), d = new Date(now), tenth = Math.floor(d.getMilliseconds() / 100);
    if (tenth !== lastTenth) {
      lastTenth = tenth;
      $("#srvTime").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
      $("#srvTenth").textContent = "." + tenth;
      if (tenth === 0) $("#srvDate").textContent = dateFmt.format(d);
      tickAlarm(now);
    }
  }

  /* ---------- 정각 알림 ---------- */
  function alarmTarget() {
    var v = $("#alarmAt").value; if (!v) return null;
    var p = v.split(":"), sn = new Date(serverNow());
    var t = new Date(sn.getFullYear(), sn.getMonth(), sn.getDate(), +p[0], +p[1], +(p[2] || 0), 0).getTime();
    // 서버 시각 기준 → 기기 시각으로 환산해 저장
    var devTarget = t - st.dev - st.srv;
    if (devTarget < Date.now() - 1000) devTarget += 864e5; // 이미 지났으면 내일
    return devTarget;
  }
  function cancelScheduled() {
    if (alarm.scheduled) { alarm.scheduled.forEach(function (o) { try { o && o.disconnect(); } catch (e) { /* 무시 */ } }); }
    alarm.scheduled = null;
  }
  // 남은 시간이 20초 안이면 오디오 시계에 삐-삐-삐-띵 예약
  function reschedule() {
    cancelScheduled();
    if (!alarm.at) return;
    alarm.at = alarmTarget() || alarm.at;
    var left = (alarm.at - Date.now()) / 1000;
    if (left > 20 || left < -1) return;
    var outs = [];
    if ($("#alarmBeeps").checked) for (var k = 5; k >= 1; k--) if (left - k > 0.05) outs.push(TD.play("beep", 0.6, 1, left - k));
    outs.push(TD.play("bell", 0.9, 2, Math.max(0, left)));
    alarm.scheduled = outs;
  }
  function tickAlarm() {
    if (!alarm.at) return;
    var left = (alarm.at - Date.now()) / 1000;
    if (left <= 20 && !alarm.scheduled && left > -1) reschedule();
    var c = $("#srvCount");
    if (left <= 10 && left > 0) { c.hidden = false; c.textContent = Math.ceil(left); root.classList.add("soon"); }
    else if (left <= 0 && left > -3) { c.hidden = false; c.textContent = T.now; root.classList.add("soon"); }
    else { c.hidden = true; root.classList.remove("soon"); }
    if (left <= -3) { // 끝 → 알림 해제
      alarm.at = null; alarm.scheduled = null;
      $("#alarmBtn").textContent = T.alarmOn; $("#alarmStatus").textContent = "";
      TD.keepAwake(false);
    }
  }
  $("#alarmBtn").addEventListener("click", function () {
    TD.unlockAudio();
    if (alarm.at) {
      cancelScheduled(); alarm.at = null;
      $("#alarmBtn").textContent = T.alarmOn; $("#alarmStatus").textContent = ""; $("#srvCount").hidden = true;
      root.classList.remove("soon"); TD.keepAwake(false);
      return;
    }
    var at = alarmTarget();
    if (!at) { $("#alarmAt").focus(); return; }
    alarm.at = at;
    $("#alarmBtn").textContent = T.alarmOff;
    $("#alarmStatus").textContent = T.alarmSet.replace("{t}", $("#alarmAt").value);
    TD.keepAwake(true);
    reschedule();
    TD.track("server_alarm", { site: st.url || "standard" });
  });
  $("#alarmAt").addEventListener("change", function () { if (alarm.at) { alarm.at = alarmTarget(); reschedule(); } });

  /* ---------- 대상 고르기 ---------- */
  $("#srvSites").innerHTML = SITES.map(function (s) {
    return '<button type="button" class="chip" data-url="' + s.url + '">' + s.label + "</button>";
  }).join("");
  $("#srvSites").addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    // 사이트별 페이지에서는 다른 사이트의 전용 페이지로 이동 (본 페이지에서는 그 자리에서 전환)
    if (PAGE_SITE && b.dataset.url !== PAGE_SITE.url) {
      location.href = PAGES[b.dataset.url] || (location.pathname.replace(/[^/]+\/$/, "") + (b.dataset.url ? "?site=" + encodeURIComponent(b.dataset.url) : ""));
      return;
    }
    setTarget(b.dataset.url, b.textContent);
  });
  $("#srvForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = $("#srvUrl").value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    var known = SITES.filter(function (s) { return s.url === v; })[0];
    setTarget(v, known ? known.label : v);
  });
  $("#fsBtn").addEventListener("click", function () { TD.toggleFullscreen(root); });
  TD.keys({ KeyF: function () { TD.toggleFullscreen(root); } });

  // 기본값: 주소의 ?site= > 마지막 사용 > 표준시. 알림 시각 기본 = 다음 정각
  var q = new URLSearchParams(location.search).get("site");
  var last = TD.load("srv-last", null);
  var init = q ? { url: q.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") } : (PAGE_SITE || last || { url: "" });
  var knownInit = SITES.filter(function (s) { return s.url === init.url; })[0];
  var sn = new Date(); $("#alarmAt").value = pad((sn.getHours() + 1) % 24) + ":00:00";

  setInterval(frame, 40); // rAF는 백그라운드·숨김 창에서 멈추므로 타이머로 그린다
  frame();
  if (!API) { st.error = T.errors["fetch-failed"]; render(); return; }
  syncDevice().then(function () {
    setTarget(init.url || "", init.url ? (init === PAGE_SITE ? PAGE_SITE.label : knownInit ? knownInit.label : init.label || init.url) : T.standard);
  }).catch(function () { st.error = T.errors["fetch-failed"]; render(); });
  // 주기적 재측정 (탭이 보일 때만)
  setInterval(function () { if (document.visibilityState === "visible") syncDevice().then(measureServer); }, 60000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") syncDevice().then(measureServer); });
})(window.TD);

/* 첫 화면 위젯: ① 큰 타이머(숫자를 눌러 직접 입력·▲▼ 조절) ② 바로 시작 프리셋 ③ 현재 시각 */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, U = TD.i18n.ui, $ = TD.$, pad = TD.pad;
  var root = $("#tool"), PRESETS = [1, 3, 5, 10, 15, 25, 30, 60];
  var inH = $("#htH"), inM = $("#htM"), inS = $("#htS"), startBtn = $("#htStart");
  var MAX = { h: 23, m: 59, s: 59 }, IN = { h: inH, m: inM, s: inS };
  var dateFmt = new Intl.DateTimeFormat(TD.lang, { dateStyle: "full" });
  var ampmFmt = U.clock24 ? null : new Intl.DateTimeFormat(TD.lang, { hour: "numeric", hour12: true });
  var last = TD.load("home-last", 300); // 마지막으로 맞춘 시간(초)
  var cd = new TD.Countdown({ onTick: renderRemaining, onDone: done });
  var lastSec = -1;

  /* ---------- 입력값 <-> 초 ---------- */
  function clampSeg(k, v) { v = parseInt(v, 10); return isNaN(v) ? 0 : Math.min(MAX[k], Math.max(0, v)); }
  function readInputs() { return clampSeg("h", inH.value) * 3600 + clampSeg("m", inM.value) * 60 + clampSeg("s", inS.value); }
  function showSeconds(sec) {
    sec = Math.max(0, Math.ceil(sec - 1e-6));
    inH.value = pad(Math.floor(sec / 3600));
    inM.value = pad(Math.floor(sec % 3600 / 60));
    inS.value = pad(sec % 60);
    root.classList.toggle("no-hours", sec < 3600 && !editingHours());
  }
  function editingHours() { return document.activeElement === inH || +inH.value > 0; }
  function isIdle() { return !cd.running && !(cd.remaining() > 0 && cd.remaining() < cd.total); }

  function setEditable(on) {
    [inH, inM, inS].forEach(function (el) { el.readOnly = !on; el.tabIndex = on ? 0 : -1; });
    root.classList.toggle("locked", !on);
  }

  /* ---------- 타이머 ---------- */
  function renderRemaining(rem) {
    if (!isIdle() || rem === 0) showSeconds(rem);
    $("#htBar").style.width = (cd.total ? (1 - rem / cd.total) * 100 : 0).toFixed(2) + "%";
    if (cd.running) TD.setTitle(TD.fmt(rem) + " ⏱");
  }
  function syncBtn() {
    var paused = !cd.running && cd.remaining() > 0 && cd.remaining() < cd.total;
    startBtn.textContent = cd.running ? U.pause : paused ? U.resume : root.classList.contains("done") ? T.restart : U.start;
    root.classList.toggle("running", cd.running);
    setEditable(!cd.running && !paused);
    TD.keepAwake(cd.running || !!document.fullscreenElement);
  }
  function start(sec) {
    TD.unlockAudio();
    if (sec == null) sec = readInputs();
    if (sec <= 0) { $("#htMsg").textContent = T.setFirst; inM.focus(); return; }
    root.classList.remove("done");
    $("#htMsg").textContent = "";
    last = sec; TD.save("home-last", sec);
    cd.set(sec); cd.start(); syncBtn();
  }
  function toggle() {
    if (cd.running) { cd.pause(); syncBtn(); return; }
    if (cd.remaining() > 0 && cd.remaining() < cd.total) { cd.start(); syncBtn(); return; }
    start(root.classList.contains("done") ? last : null);
  }
  function reset() {
    cd.set(0);
    root.classList.remove("done");
    $("#htMsg").textContent = "";
    $("#htBar").style.width = "0%";
    showSeconds(last);
    syncBtn();
    lastSec = -1; tickClock();
  }
  function done() {
    TD.play("bell", 0.8, 3);
    TD.notify("⏱ TimerDesk", T.timeUp);
    root.classList.add("done");
    $("#htMsg").textContent = T.timeUp;
    syncBtn();
  }

  /* ---------- 입력 조작 ---------- */
  [["h", inH], ["m", inM], ["s", inS]].forEach(function (p) {
    var k = p[0], el = p[1];
    el.addEventListener("focus", function () { if (!el.readOnly) setTimeout(function () { el.select(); }, 0); root.classList.remove("no-hours"); });
    el.addEventListener("input", function () {
      el.value = el.value.replace(/\D/g, "").slice(0, 2);
      if (el.value.length === 2) { // 두 자리 입력하면 다음 칸으로
        if (el === inH) inM.focus(); else if (el === inM) inS.focus();
      }
    });
    el.addEventListener("blur", function () { el.value = pad(clampSeg(k, el.value)); if (isIdle()) { last = readInputs(); showSeconds(last); } });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); el.blur(); start(); }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); step(k, e.key === "ArrowUp" ? (k === "s" ? 10 : 1) : (k === "s" ? -10 : -1)); }
    });
  });
  function step(k, d) {
    if (!isIdle()) return;
    var v = clampSeg(k, IN[k].value) + d, span = MAX[k] + 1;
    if (Math.abs(d) === 1) v = ((v % span) + span) % span; // 1씩: 59 → 00 순환
    else if (v > MAX[k]) v = 0; else if (v < 0) v = MAX[k] - (MAX[k] % Math.abs(d)); // 10씩(초 ▲▼)
    IN[k].value = pad(v);
    last = readInputs();
    root.classList.remove("done", "no-hours");
    if (k !== "h" && +inH.value === 0) root.classList.add("no-hours");
  }
  root.addEventListener("click", function (e) {
    var b = e.target.closest(".ht-step");
    if (b) step(b.dataset.step, +b.dataset.d);
  });

  /* ---------- 숫자 위에서 위아래로 끌어 조절 (클릭만 하면 직접 입력) ---------- */
  var PX = 16, drag = null; // 16px 끌 때마다 1씩
  [["h", inH], ["m", inM], ["s", inS]].forEach(function (p) {
    var k = p[0], el = p[1];
    el.addEventListener("pointerdown", function (e) {
      if (!isIdle() || e.button > 0) return;
      if (document.activeElement === el) return; // 이미 입력 중이면 커서 이동 등 기본 동작
      e.preventDefault(); // 누르자마자 포커스가 가면 드래그 중 글자가 선택되므로 막는다
      drag = { k: k, el: el, y: e.clientY, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    });
    el.addEventListener("pointermove", function (e) {
      if (!drag || drag.el !== el) return;
      var dy = drag.y - e.clientY;
      if (!drag.moved && Math.abs(dy) > 5) { drag.moved = true; root.classList.add("dragging"); }
      if (!drag.moved) return;
      var n = dy > 0 ? Math.floor(dy / PX) : Math.ceil(dy / PX);
      if (n) { step(k, n); drag.y -= n * PX; }
    });
    function end() {
      if (!drag || drag.el !== el) return;
      var moved = drag.moved;
      drag = null;
      root.classList.remove("dragging");
      if (!moved) { el.focus(); el.select(); } // 그냥 눌렀으면 직접 입력
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", function () { drag = null; root.classList.remove("dragging"); });
    // 마우스 휠: 그 칸을 선택했을 때만 (페이지 스크롤을 가로채지 않도록)
    el.addEventListener("wheel", function (e) {
      if (!isIdle() || document.activeElement !== el) return;
      e.preventDefault();
      step(k, e.deltaY < 0 ? 1 : -1);
      el.select();
    }, { passive: false });
  });

  /* ---------- 바로 시작 ---------- */
  $("#htPresets").innerHTML = PRESETS.map(function (m) {
    return '<button type="button" class="chip" data-m="' + m + '">' + m + T.minShort + "</button>";
  }).join("");
  $("#htPresets").addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (!b) return;
    cd.set(0);
    showSeconds(+b.dataset.m * 60);
    start(+b.dataset.m * 60);
  });

  /* ---------- 현재 시각 (보는 사람 기기의 시간대 — 언어와 무관) ---------- */
  (function showZone() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      var long = new Intl.DateTimeFormat(TD.lang, { timeZoneName: "long" }).formatToParts(new Date())
        .filter(function (x) { return x.type === "timeZoneName"; })[0];
      var city = zone.split("/").pop().replace(/_/g, " ");
      $("#htTz").textContent = "🌐 " + (long ? long.value : zone) + (city && zone.indexOf("/") > 0 ? " · " + city : "");
    } catch (e) { /* 미지원 브라우저 */ }
  })();
  function tickClock() {
    var now = new Date();
    if (now.getSeconds() === lastSec) return;
    lastSec = now.getSeconds();
    var h = now.getHours(), ap = "";
    if (ampmFmt) {
      var part = ampmFmt.formatToParts(now).filter(function (x) { return x.type === "dayPeriod"; })[0];
      ap = part ? part.value : "";
      h = h % 12 || 12;
    }
    var s = (ampmFmt ? h : pad(h)) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
    $("#htClock").textContent = s;
    $("#htAmPm").textContent = ap;
    $("#htDate").textContent = dateFmt.format(now);
    if (isIdle()) TD.setTitle(s);
  }

  startBtn.addEventListener("click", toggle);
  $("#htReset").addEventListener("click", reset);
  $("#fsBtn").addEventListener("click", function () { TD.toggleFullscreen(root); });
  document.addEventListener("fullscreenchange", function () { TD.keepAwake(cd.running || !!document.fullscreenElement); });
  TD.keys({ Space: toggle, KeyR: reset, KeyF: function () { TD.toggleFullscreen(root); } });

  showSeconds(last);
  syncBtn();
  tickClock();
  setInterval(tickClock, 200);
})(window.TD);

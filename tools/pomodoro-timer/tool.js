/* 뽀모도로 타이머: 집중 → 짧은 휴식 반복, N회마다 긴 휴식. 완료한 집중 세션을 날짜별로 기록. */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, U = TD.i18n.ui, $ = TD.$;
  var root = $("#tool"), timeEl = $("#time"), ring = $("#ringFg"), startBtn = $("#startBtn");
  var CIRC = 628.32; // 2πr, r=100 (tool.html 의 stroke-dasharray 와 같이 바꿀 것)
  var DEF = { focus: 25, short: 5, long: 15, longEvery: 4, autoStart: true, sound: "bell", volume: 0.7 };
  var cfg = Object.assign({}, DEF, TD.load("pomo-cfg", {}));
  var stats = TD.load("pomo-stats", {}); // { "YYYY-MM-DD": { count, min } }
  var mode = "focus", done = 0, asked = false;
  var cd = new TD.Countdown({ onTick: render, onDone: complete });

  function render(rem) {
    timeEl.textContent = TD.fmt(rem);
    var frac = cd.total ? rem / cd.total : 1;
    ring.style.strokeDashoffset = (CIRC * (1 - frac)).toFixed(2);
    TD.setTitle(cd.running ? TD.fmt(rem) + " " + T[mode] : null);
  }

  function syncBtn() {
    startBtn.textContent = cd.running ? U.pause : (cd.remaining() < cd.total ? U.resume : U.start);
    root.classList.toggle("running", cd.running);
    TD.keepAwake(cd.running);
  }

  function setMode(m, autostart) {
    mode = m;
    root.dataset.mode = m;
    TD.$$(".tab", root).forEach(function (b) {
      var on = b.dataset.mode === m;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on);
    });
    $("#modeLabel").textContent = T[m + "Label"];
    cd.set(Math.round(cfg[m] * 60));
    renderDots();
    if (autostart) start();
    syncBtn();
  }

  function start() {
    if (!asked) { asked = true; TD.askNotify(); }
    cd.start();
    syncBtn();
  }

  function toggle() {
    TD.unlockAudio();
    if (cd.running) cd.pause(); else start();
    syncBtn();
  }

  function complete() {
    TD.play(cfg.sound, cfg.volume, 2);
    if (mode === "focus") {
      done++;
      var k = TD.dateKey(new Date()), s = stats[k] || { count: 0, min: 0 };
      s.count++;
      s.min += cfg.focus;
      stats[k] = s;
      prune();
      TD.save("pomo-stats", stats);
      renderStats();
      TD.notify("🍅 " + T.focus, T.notifyFocusDone);
      setMode(done % cfg.longEvery === 0 ? "long" : "short", cfg.autoStart);
    } else {
      TD.notify("🍅 " + T.focus, T.notifyBreakDone);
      setMode("focus", cfg.autoStart);
    }
  }

  function prune() {
    var keys = Object.keys(stats).sort();
    while (keys.length > 120) delete stats[keys.shift()];
  }

  function renderDots() {
    var n = cfg.longEvery, filled = done % n;
    if (mode === "long" && done > 0 && filled === 0) filled = n;
    var html = "";
    for (var i = 0; i < n; i++) html += '<i class="' + (i < filled ? "on" : "") + '"></i>';
    $("#dots").innerHTML = html;
  }

  function renderStats() {
    var now = new Date(), s = stats[TD.dateKey(now)] || { count: 0, min: 0 };
    $("#todayCount").textContent = s.count;
    $("#todayMin").textContent = s.min;
    var days = [], max = 60, wd = new Intl.DateTimeFormat(TD.lang, { weekday: "short" });
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      var v = (stats[TD.dateKey(d)] || {}).min || 0;
      days.push([d, v]);
      if (v > max) max = v;
    }
    $("#week").innerHTML = days.map(function (x, i) {
      return '<div class="day' + (i === 6 ? " today" : "") + '" title="' + x[1] + T.minUnit + '">' +
        '<div class="bar"><i style="height:' + Math.round(x[1] / max * 100) + '%"></i></div>' +
        "<b>" + (x[1] || "") + "</b><span>" + wd.format(x[0]) + "</span></div>";
    }).join("");
  }

  function bindSettings() {
    TD.fillSoundSelect($("#sound"), cfg.sound);
    TD.$$("[data-key]", root).forEach(function (el) {
      var k = el.dataset.key;
      if (el.type === "checkbox") el.checked = !!cfg[k]; else el.value = cfg[k];
      el.addEventListener("change", function () {
        var v;
        if (el.type === "checkbox") v = el.checked;
        else if (el.type === "number") {
          v = Math.round(+el.value) || DEF[k];
          v = Math.min(+el.max, Math.max(+el.min, v));
          el.value = v;
        } else if (el.type === "range") v = +el.value;
        else v = el.value;
        cfg[k] = v;
        TD.save("pomo-cfg", cfg);
        // 아직 시작 전이면 바뀐 시간을 바로 반영
        if (k === mode && !cd.running && cd.remaining() === cd.total) cd.set(Math.round(cfg[mode] * 60));
        if (k === "longEvery") renderDots();
      });
    });
    $("#testSound").addEventListener("click", function () { TD.play(cfg.sound, cfg.volume); });
  }

  // 이벤트
  TD.$$(".tab", root).forEach(function (b) { b.addEventListener("click", function () { setMode(b.dataset.mode, false); }); });
  startBtn.addEventListener("click", toggle);
  $("#resetBtn").addEventListener("click", function () { cd.set(Math.round(cfg[mode] * 60)); syncBtn(); });
  $("#skipBtn").addEventListener("click", function () { setMode(mode === "focus" ? "short" : "focus", false); });
  $("#fsBtn").addEventListener("click", function () { TD.toggleFullscreen(root); });
  $("#resetStats").addEventListener("click", function () {
    if (confirm(T.resetConfirm)) { stats = {}; TD.save("pomo-stats", stats); renderStats(); }
  });
  var task = $("#task");
  task.value = TD.load("pomo-task", "");
  task.addEventListener("input", function () { TD.save("pomo-task", task.value); });
  TD.keys({
    Space: toggle,
    KeyR: function () { $("#resetBtn").click(); },
    KeyF: function () { TD.toggleFullscreen(root); }
  });

  bindSettings();
  setMode("focus", false);
  renderStats();
})(window.TD);

/* 시각 타이머: 남은 시간을 원판(부채꼴) 면적으로 표시.
   눈금은 12시 기준 반시계 방향으로 증가하고, 시간이 흐르면 원판 가장자리가 시곗바늘처럼 12시 쪽으로 줄어든다. */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, U = TD.i18n.ui, $ = TD.$, NS = "http://www.w3.org/2000/svg";
  var root = $("#tool"), svg = $("#dial"), timeEl = $("#time"), startBtn = $("#startBtn");
  var COLORS = { red: "#e5484d", blue: "#3e63dd", green: "#2f9e44", orange: "#f76707", purple: "#8e4ec6" };
  var SCALES = [10, 20, 30, 60, 120], PRESETS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
  var R = 106; // 원판 반지름
  var DEF = { scale: 60, color: "red", digital: true, sound: "bell", volume: 0.8, last: 600 };
  var cfg = Object.assign({}, DEF, TD.load("visual-cfg", {}));
  var sector, doneTimer = null;
  var cd = new TD.Countdown({ onTick: render, onDone: finish });

  function save() { TD.save("visual-cfg", cfg); }
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  // deg: 12시 기준 시계 방향 각도
  function polar(deg, r) { var a = deg * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; }
  function labelStep(sc) { return [1, 2, 5, 10, 15, 20].filter(function (s) { return sc / s <= 12; })[0]; }

  function buildFace() {
    svg.innerHTML = "";
    el("circle", { r: 156, class: "face" }, svg);
    var ticks = el("g", { class: "ticks" }, svg), labels = el("g", { class: "labels" }, svg);
    var sc = cfg.scale, step = labelStep(sc), n = sc <= 10 ? sc * 2 : sc <= 60 ? sc : sc / 2;
    for (var i = 0; i < n; i++) {
      var val = i * sc / n, deg = -val / sc * 360, major = Math.abs(val / step - Math.round(val / step)) < 1e-9;
      var p1 = polar(deg, 150), p2 = polar(deg, major ? 134 : 142);
      el("line", { x1: p1[0].toFixed(2), y1: p1[1].toFixed(2), x2: p2[0].toFixed(2), y2: p2[1].toFixed(2), class: major ? "major" : "minor" }, ticks);
      if (major) {
        var p = polar(deg, 120);
        el("text", { x: p[0].toFixed(2), y: p[1].toFixed(2) }, labels).textContent = String(Math.round(val));
      }
    }
    sector = el("path", { class: "sector", fill: COLORS[cfg.color] || COLORS.red }, svg);
    el("circle", { r: 11, class: "knob" }, svg);
  }

  function wedge(deg) {
    if (deg <= 0.05) return "M0,0";
    if (deg >= 359.95) return "M0,-" + R + " A" + R + "," + R + " 0 1,0 0," + R + " A" + R + "," + R + " 0 1,0 0,-" + R + " Z";
    var p = polar(-deg, R);
    return "M0,0 L0,-" + R + " A" + R + "," + R + " 0 " + (deg > 180 ? 1 : 0) + ",0 " + p[0].toFixed(2) + "," + p[1].toFixed(2) + " Z";
  }

  function render(rem) {
    sector.setAttribute("d", wedge(Math.min(1, rem / (cfg.scale * 60)) * 360));
    timeEl.textContent = TD.fmt(rem);
    TD.setTitle(cd.running ? TD.fmt(rem) : null);
  }

  function syncBtn() {
    startBtn.textContent = cd.running ? U.pause : (cd.remaining() > 0 && cd.remaining() < cd.total ? U.resume : U.start);
    root.classList.toggle("running", cd.running);
    TD.keepAwake(cd.running);
  }

  function setTime(sec) {
    cfg.last = sec;
    save();
    cd.set(sec);
    syncBtn();
  }

  function toggle() {
    TD.unlockAudio();
    clearDone();
    if (cd.running) cd.pause();
    else {
      if (cd.remaining() <= 0) cd.set(cfg.last || 600);
      cd.start();
    }
    syncBtn();
  }

  function finish() {
    TD.play(cfg.sound, cfg.volume, 3);
    root.classList.add("done");
    doneTimer = setTimeout(clearDone, 6000);
    syncBtn();
  }
  function clearDone() { clearTimeout(doneTimer); root.classList.remove("done"); }

  function setScale(sc) {
    cfg.scale = sc;
    $("#scale").value = String(sc);
    save();
    buildFace();
    if (cd.remaining() > sc * 60) setTime(sc * 60); else render(cd.remaining());
  }

  /* ---------- 원판 드래그로 시간 맞추기 ---------- */
  var dragging = false, wasRunning = false, lastFrac = 0;
  function fracAt(e) {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return lastFrac;
    var x = (e.clientX - r.left) / r.width * 320 - 160, y = (e.clientY - r.top) / r.height * 320 - 160;
    var cw = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    return ((360 - cw) % 360) / 360; // 반시계 방향 비율
  }
  function applyFrac(f, first) {
    // 12시를 넘어 반대편으로 튀는 것 방지 (가득 ↔ 0)
    if (!first) {
      if (lastFrac > 0.75 && f < 0.25) f = 1;
      else if (lastFrac < 0.25 && f > 0.75) f = 0;
    }
    lastFrac = f;
    var snap = cfg.scale <= 10 ? 15 : cfg.scale <= 30 ? 30 : 60;
    cd.set(Math.round(f * cfg.scale * 60 / snap) * snap);
  }
  svg.addEventListener("pointerdown", function (e) {
    dragging = true;
    clearDone();
    wasRunning = cd.running;
    cd.pause();
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    applyFrac(fracAt(e), true);
  });
  svg.addEventListener("pointermove", function (e) { if (dragging) applyFrac(fracAt(e), false); });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    var sec = cd.remaining();
    if (sec > 0) { cfg.last = sec; save(); }
    if (wasRunning && sec > 0) cd.start();
    syncBtn();
  }
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  /* ---------- 색상 · 프리셋 · 설정 ---------- */
  $("#colors").innerHTML = Object.keys(COLORS).map(function (k) {
    return '<button type="button" class="swatch" role="radio" data-c="' + k + '" style="--c:' + COLORS[k] + '" aria-label="' + T.colors[k] + '" title="' + T.colors[k] + '"></button>';
  }).join("");
  function syncColor() {
    TD.$$(".swatch", root).forEach(function (b) { b.setAttribute("aria-checked", b.dataset.c === cfg.color); });
    if (sector) sector.setAttribute("fill", COLORS[cfg.color] || COLORS.red);
    root.style.setProperty("--dial", COLORS[cfg.color] || COLORS.red);
  }
  $("#colors").addEventListener("click", function (e) {
    var b = e.target.closest(".swatch");
    if (!b) return;
    cfg.color = b.dataset.c;
    save();
    syncColor();
  });

  $("#presets").innerHTML = PRESETS.map(function (m) { return '<button type="button" class="chip" data-m="' + m + '">' + m + T.minShort + "</button>"; }).join("");
  $("#presets").addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (!b) return;
    clearDone();
    var m = +b.dataset.m;
    if (m > cfg.scale) setScale(SCALES.filter(function (s) { return s >= m; })[0]);
    setTime(m * 60);
  });

  TD.fillSoundSelect($("#sound"), cfg.sound);
  TD.$$("[data-key]", root).forEach(function (input) {
    var k = input.dataset.key;
    if (input.type === "checkbox") input.checked = !!cfg[k]; else input.value = String(cfg[k]);
    input.addEventListener("change", function () {
      if (k === "scale") { setScale(+input.value); return; }
      cfg[k] = input.type === "checkbox" ? input.checked : input.type === "range" ? +input.value : input.value;
      save();
      if (k === "digital") timeEl.hidden = !cfg.digital;
    });
  });
  $("#testSound").addEventListener("click", function () { TD.play(cfg.sound, cfg.volume); });

  startBtn.addEventListener("click", toggle);
  $("#resetBtn").addEventListener("click", function () { clearDone(); cd.set(cfg.last || 600); syncBtn(); });
  $("#fsBtn").addEventListener("click", function () { TD.toggleFullscreen(root); });
  TD.keys({
    Space: toggle,
    KeyR: function () { $("#resetBtn").click(); },
    KeyF: function () { TD.toggleFullscreen(root); }
  });

  if (SCALES.indexOf(+cfg.scale) < 0) cfg.scale = DEF.scale;
  cfg.scale = +cfg.scale;
  buildFace();
  syncColor();
  timeEl.hidden = !cfg.digital;
  cd.set(Math.min(cfg.last || 600, cfg.scale * 60));
  syncBtn();
})(window.TD);

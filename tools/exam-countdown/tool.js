/* 시험 D-day 카운트다운: 목표 시각까지 남은 일·시·분·초와 D-day 표기.
   ?d=YYYY-MM-DD&t=HH:MM&title=… 링크로 나만의 카운트다운을 공유할 수 있다. */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, $ = TD.$, pad = TD.pad;
  var root = $("#tool");
  // 2027학년도 수능: 2026-11-19(목) 08:40 (교육부) / 2027 共通テスト: 2027-01-16(土) 09:30 (大学入試センター)
  var PRESETS = { csat: { date: "2026-11-19", time: "08:40" }, kyotsu: { date: "2027-01-16", time: "09:30" } };
  // 시험별 하위 페이지(/ja/exam-countdown/takken/ 등)는 그 시험을 첫 프리셋으로 두고 저장값보다 우선한다
  var PAGE = window.TD_EXAM || null;
  if (PAGE) {
    PRESETS.page = { date: PAGE.date, time: PAGE.time || "" };
    T.presets = Object.assign({}, T.presets, { page: PAGE.title });
    T.notes = Object.assign({}, T.notes, { page: PAGE.note || "" });
    T.presetOrder = ["page"].concat(T.presetOrder);
  }
  var cfg = PAGE ? { preset: "page", title: "", date: "", time: "" }
    : Object.assign({ preset: T.presetOrder[0], title: "", date: "", time: "09:00" }, TD.load("countdown-cfg", {}));

  // 공유 링크로 들어온 경우 그 값을 우선
  // 네이버 앱 등은 `&`를 `&#38;`로 바꿔 열어 title이 #뒤로 밀린다 → 해시도 쿼리로 읽는다
  var q = new URLSearchParams(location.search + "&" + decodeURIComponent(location.hash).replace(/^#(38;)?/, ""));
  if (q.get("d") && /^\d{4}-\d{2}-\d{2}$/.test(q.get("d"))) {
    cfg = { preset: "custom", title: (q.get("title") || "").slice(0, 40), date: q.get("d"), time: /^\d{2}:\d{2}$/.test(q.get("t") || "") ? q.get("t") : "" };  // 시각이 없으면 날짜만 표시
  }

  function target() {
    var p = PRESETS[cfg.preset];
    return p ? { title: T.presets[cfg.preset], date: p.date, time: p.time } : { title: cfg.title || T.myCountdown, date: cfg.date, time: cfg.time || "" };
  }
  function toMs(date, time) {
    var d = date.split("-"), t = (time || "00:00").split(":");
    return new Date(+d[0], +d[1] - 1, +d[2], +t[0], +t[1], 0, 0).getTime();
  }

  function renderPresets() {
    $("#presets").innerHTML = T.presetOrder.map(function (k) {
      return '<button class="tab' + (k === cfg.preset ? " active" : "") + '" role="tab" data-p="' + k + '">' + (k === "custom" ? T.custom : T.presets[k]) + "</button>";
    }).join("");
  }

  function fillForm() {
    var tg = target();
    $("#cdLabel").value = cfg.preset === "custom" ? cfg.title : "";
    $("#cdDate").value = tg.date || "";
    $("#cdTime").value = tg.time || "";
    $("#cdNote").textContent = T.notes[cfg.preset] || "";
  }

  function tick() {
    var tg = target();
    if (!tg.date) {
      $("#cdTitle").textContent = T.myCountdown;
      $("#dday").textContent = "D-?";
      $("#cdTarget").textContent = T.pickDate;
      return;
    }
    var at = toMs(tg.date, tg.time), now = new Date();
    // D-day는 시각과 무관하게 날짜 차이로 센다 (당일 = D-DAY)
    var d = tg.date.split("-");
    var dayDiff = Math.round((new Date(+d[0], +d[1] - 1, +d[2]) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    var dday = dayDiff > 0 ? "D-" + dayDiff : dayDiff === 0 ? "D-DAY" : "D+" + (-dayDiff);
    var rem = Math.max(0, Math.floor((at - now.getTime()) / 1000));
    $("#cdTitle").textContent = tg.title;
    $("#dday").textContent = dday;
    $("#cdD").textContent = Math.floor(rem / 86400);
    $("#cdH").textContent = pad(Math.floor(rem % 86400 / 3600));
    $("#cdM").textContent = pad(Math.floor(rem % 3600 / 60));
    $("#cdS").textContent = pad(rem % 60);
    root.classList.toggle("passed", rem === 0);
    $("#cdTarget").textContent = rem === 0 ? T.passed :
      new Intl.DateTimeFormat(TD.lang, { dateStyle: "full" }).format(new Date(at)) + (tg.time ? " " + TD.clock(at) : "");
    TD.setTitle(dday + " " + tg.title);
  }

  $("#presets").addEventListener("click", function (e) {
    var b = e.target.closest(".tab");
    if (!b) return;
    cfg.preset = b.dataset.p;
    if (cfg.preset === "custom") $("#cdSettings").open = true;
    if (!PAGE || cfg.preset === "custom") TD.save("countdown-cfg", cfg);
    renderPresets(); fillForm(); tick();
  });
  $("#applyBtn").addEventListener("click", function () {
    if (!$("#cdDate").value) { $("#cdDate").focus(); return; }
    cfg = { preset: "custom", title: $("#cdLabel").value.trim(), date: $("#cdDate").value, time: $("#cdTime").value || "" };
    if (!PAGE || cfg.preset === "custom") TD.save("countdown-cfg", cfg);
    renderPresets(); fillForm(); tick();
  });
  $("#copyBtn").addEventListener("click", function () {
    var tg = target(), b = $("#copyBtn");
    var url = location.origin + location.pathname;
    if (cfg.preset === "custom" && tg.date) url += "?d=" + tg.date + (tg.time ? "&t=" + tg.time : "") + (cfg.title ? "&title=" + encodeURIComponent(cfg.title) : "");
    TD.track("share_link", { preset: cfg.preset });
    var done = function () { b.textContent = "✓ " + T.copied; setTimeout(function () { b.textContent = "🔗 " + T.copyLink; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt(T.copyLink, url); });
    else prompt(T.copyLink, url);
  });
  $("#fsBtn").addEventListener("click", function () { TD.toggleFullscreen(root); });
  document.addEventListener("fullscreenchange", function () { TD.keepAwake(!!document.fullscreenElement); });
  TD.keys({ KeyF: function () { TD.toggleFullscreen(root); } });

  if (T.presetOrder.indexOf(cfg.preset) < 0) cfg.preset = T.presetOrder[0];
  renderPresets();
  fillForm();
  if (!target().date) $("#cdSettings").open = true;
  tick();
  setInterval(tick, 250);
})(window.TD);

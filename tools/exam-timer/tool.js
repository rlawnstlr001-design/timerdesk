/* 시험 타이머: 교시(과목·시간·쉬는 시간) 목록을 실제 시각표로 펼쳐 놓고,
   현재 시각 기준으로 진행 중인 교시·남은 시간을 보여준다. 일시정지하면 이후 시각표 전체가 밀린다. */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, U = TD.i18n.ui, $ = TD.$;
  var root = $("#tool"), rowsEl = $("#rows"), presetSel = $("#preset"), startAt = $("#startAt");
  var MIN = 60000;
  // [항목 키, 시험 분, 이후 쉬는 시간 분]. anchor = 실제 시험 시작 시각
  var PRESETS = {
    csat: { anchor: "08:40", items: [["kor", 80, 30], ["math", 100, 60], ["eng", 70, 30], ["hist", 30, 15], ["inq1", 30, 2], ["inq2", 30, 28], ["lang2", 40, 0]] },
    toeic: { items: [["lc", 45, 0], ["rc", 75, 0]] },
    sat: { items: [["rw1", 32, 0], ["rw2", 32, 10], ["m1", 35, 0], ["m2", 35, 0]] },
    ielts: { items: [["listen", 30, 0], ["transfer", 10, 0], ["read", 60, 0], ["write", 60, 0]] }
  };
  var DEF = { preset: T.presetOrder[0], custom: null, warn10: true, warn5: true, sound: "chime", volume: 0.8 };
  var cfg = Object.assign({}, DEF, TD.load("exam-cfg", {}));
  var rows = [], useNow = true, sched = null, loopId = null, pausedAt = 0, fired = {}, curIdx = -2;

  function save() { TD.save("exam-cfg", cfg); }
  function fromItem(it) { return { name: T.items[it[0]], dur: it[1], gap: it[2] }; }
  function presetRows(key) {
    if (key === "custom") {
      return cfg.custom ? cfg.custom.map(function (r) { return { name: r.name, dur: r.dur, gap: r.gap }; })
        : [["custom1", 50, 10], ["custom2", 50, 0]].map(fromItem);
    }
    return PRESETS[key].items.map(fromItem);
  }
  function escHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- 설정 화면 ---------- */
  function renderRows() {
    rowsEl.innerHTML = rows.map(function (r, i) {
      return '<tr data-i="' + i + '">' +
        '<td><input class="r-name" data-f="name" maxlength="40" value="' + escHtml(r.name) + '" aria-label="' + T.colName + '"></td>' +
        '<td><input class="r-num" data-f="dur" type="number" min="1" max="600" value="' + r.dur + '" aria-label="' + T.colMin + '"></td>' +
        '<td><input class="r-num" data-f="gap" type="number" min="0" max="300" value="' + r.gap + '" aria-label="' + T.colBreak + '"' + (i === rows.length - 1 ? " disabled" : "") + "></td>" +
        '<td><button class="del" type="button" aria-label="' + T.del + '">×</button></td></tr>';
    }).join("");
  }
  function markCustom() {
    cfg.preset = "custom";
    presetSel.value = "custom";
    cfg.custom = rows.map(function (r) { return { name: r.name, dur: r.dur, gap: r.gap }; });
    save();
    updateNote();
  }
  function updateNote() {
    $("#presetNote").textContent = T.presetNotes[cfg.preset] || "";
    var p = PRESETS[cfg.preset], a = $("#anchorBtn");
    a.hidden = !(p && p.anchor);
    if (p && p.anchor) a.textContent = T.useAnchor + " " + p.anchor;
  }
  function hhmm(d) { return TD.pad(d.getHours()) + ":" + TD.pad(d.getMinutes()); }
  function setNow() { useNow = true; startAt.value = hhmm(new Date()); }
  function applyPreset(key) {
    cfg.preset = key;
    rows = presetRows(key);
    renderRows();
    updateNote();
    setNow();
    save();
  }

  rowsEl.addEventListener("input", function (e) {
    var tr = e.target.closest("tr"), f = e.target.dataset.f;
    if (!tr || !f) return;
    var r = rows[+tr.dataset.i];
    if (f === "name") r.name = e.target.value;
    else r[f] = Math.max(f === "dur" ? 1 : 0, Math.min(+e.target.max, Math.round(+e.target.value) || 0));
    markCustom();
  });
  rowsEl.addEventListener("click", function (e) {
    if (!e.target.classList.contains("del") || rows.length <= 1) return;
    rows.splice(+e.target.closest("tr").dataset.i, 1);
    renderRows();
    markCustom();
  });
  $("#addRow").addEventListener("click", function () {
    rows.push({ name: T.items.newItem + " " + (rows.length + 1), dur: 50, gap: 10 });
    if (rows.length > 1 && !rows[rows.length - 2].gap) rows[rows.length - 2].gap = 10;
    renderRows();
    markCustom();
  });
  presetSel.innerHTML = T.presetOrder.map(function (k) { return '<option value="' + k + '">' + T.presets[k] + "</option>"; }).join("");
  presetSel.addEventListener("change", function () { applyPreset(presetSel.value); });
  startAt.addEventListener("input", function () { useNow = false; });
  $("#nowBtn").addEventListener("click", setNow);
  $("#anchorBtn").addEventListener("click", function () { useNow = false; startAt.value = PRESETS[cfg.preset].anchor; });

  TD.fillSoundSelect($("#sound"), cfg.sound);
  TD.$$("[data-key]", root).forEach(function (el) {
    var k = el.dataset.key;
    if (el.type === "checkbox") el.checked = !!cfg[k]; else el.value = cfg[k];
    el.addEventListener("change", function () {
      cfg[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? +el.value : el.value;
      save();
    });
  });
  $("#testSound").addEventListener("click", function () { TD.play(cfg.sound, cfg.volume); });

  /* ---------- 진행 화면 ---------- */
  function todayAt(v) {
    var p = (v || "00:00").split(":"), d = new Date();
    d.setHours(+p[0], +p[1], 0, 0);
    return d.getTime();
  }
  function startExam() {
    TD.unlockAudio();
    var t0 = useNow ? Date.now() : todayAt(startAt.value);
    var total = rows.reduce(function (a, r) { return a + (r.dur + r.gap) * MIN; }, 0);
    if (!useNow && t0 + total < Date.now()) t0 += 24 * 60 * MIN; // 이미 지난 시각이면 내일로
    sched = [];
    var t = t0;
    rows.forEach(function (r) {
      sched.push({ name: r.name, start: t, end: t + r.dur * MIN });
      t += (r.dur + r.gap) * MIN;
    });
    fired = {}; pausedAt = 0; curIdx = -2;
    $("#setup").hidden = true;
    $("#run").hidden = false;
    $("#pauseBtn").textContent = U.pause;
    root.classList.add("running");
    renderTimeline();
    TD.keepAwake(true);
    loopId = setInterval(loop, 250);
    loop();
  }
  function stopExam() {
    clearInterval(loopId);
    sched = null;
    $("#run").hidden = true;
    $("#setup").hidden = false;
    root.classList.remove("running");
    root.dataset.warn = "";
    root.dataset.phase = "";
    TD.keepAwake(false);
    TD.setTitle(null);
  }
  function togglePause() {
    if (!sched) return;
    if (pausedAt) {
      var delta = Date.now() - pausedAt;
      sched.forEach(function (s) { s.start += delta; s.end += delta; });
      pausedAt = 0;
      $("#pauseBtn").textContent = U.pause;
      renderTimeline();
    } else {
      pausedAt = Date.now();
      $("#pauseBtn").textContent = U.resume;
    }
    root.classList.toggle("paused", !!pausedAt);
  }

  function renderTimeline() {
    $("#timeline").innerHTML = sched.map(function (s, i) {
      return '<li data-i="' + i + '"><span class="tl-time">' + TD.clock(s.start) + "–" + TD.clock(s.end) +
        '</span><span class="tl-name">' + escHtml(s.name) + "</span></li>";
    }).join("");
    curIdx = -2;
  }

  // 사건 시각에 막 도달했을 때(3초 이내)만 소리 — 중간부터 시작해도 지난 사건은 울리지 않음
  function fire(key, at, now, sound, times) {
    if (fired[key] || now < at || now - at > 3000) return;
    fired[key] = 1;
    TD.play(sound, cfg.volume, times);
  }
  function checkEvents(now) {
    sched.forEach(function (s, i) {
      fire(i + "s", s.start, now, cfg.sound, 1);
      if (cfg.warn10 && s.end - s.start > 10 * MIN) fire(i + "w10", s.end - 10 * MIN, now, "beep", 1);
      if (cfg.warn5 && s.end - s.start > 5 * MIN) fire(i + "w5", s.end - 5 * MIN, now, "beep", 1);
      fire(i + "e", s.end, now, "bell", 3);
    });
  }

  function loop() {
    var now = pausedAt || Date.now();
    if (!pausedAt) checkEvents(now);
    var first = sched[0], last = sched[sched.length - 1];
    var phase, status, name, rem = 0, meta = "", prog = 0, warn = "", idx = -1;
    if (now < first.start) {
      phase = "before"; status = T.before; name = first.name; rem = first.start - now;
      meta = T.startsAt + " " + TD.clock(first.start);
    } else if (now >= last.end) {
      phase = "done"; status = T.finished; name = T.allDone; prog = 1; idx = sched.length;
    } else {
      for (var i = 0; i < sched.length; i++) {
        var s = sched[i];
        if (now < s.start) {
          var prevEnd = sched[i - 1].end;
          phase = "break"; status = T.breakTime; name = T.next + ": " + s.name; rem = s.start - now;
          meta = T.startsAt + " " + TD.clock(s.start); prog = (now - prevEnd) / (s.start - prevEnd); idx = i - 0.5;
          break;
        }
        if (now < s.end) {
          phase = "exam"; status = T.inProgress; name = s.name; rem = s.end - now;
          meta = TD.clock(s.start) + " – " + TD.clock(s.end); prog = (now - s.start) / (s.end - s.start); idx = i;
          warn = rem <= 5 * MIN ? "5" : rem <= 10 * MIN ? "10" : "";
          break;
        }
      }
    }
    root.dataset.phase = phase;
    root.dataset.warn = warn;
    $("#status").textContent = pausedAt ? status + " · " + U.pause : status;
    $("#curName").textContent = name;
    $("#time").textContent = TD.fmt(rem / 1000);
    $("#bar").style.width = (Math.min(1, Math.max(0, prog)) * 100).toFixed(2) + "%";
    $("#meta").textContent = meta;
    TD.setTitle(phase === "done" ? null : TD.fmt(rem / 1000) + " " + name);
    if (phase === "done") TD.keepAwake(false);
    if (idx !== curIdx) {
      curIdx = idx;
      TD.$$("#timeline li").forEach(function (li) {
        var j = +li.dataset.i;
        li.className = j < idx ? "done" : j === idx ? "current" : "";
      });
    }
  }

  // 현재 시각 (일시정지와 무관하게 항상 실제 시각)
  function tickClock() { $("#clockNow").textContent = TD.clock(Date.now(), true); }
  setInterval(tickClock, 1000);
  tickClock();

  $("#startBtn").addEventListener("click", startExam);
  $("#stopBtn").addEventListener("click", stopExam);
  $("#pauseBtn").addEventListener("click", togglePause);
  $("#fsBtn").addEventListener("click", function () { TD.toggleFullscreen(root); });
  TD.keys({
    Space: function () { if (sched) togglePause(); },
    KeyF: function () { TD.toggleFullscreen(root); }
  });

  if (T.presetOrder.indexOf(cfg.preset) < 0) cfg.preset = DEF.preset;
  presetSel.value = cfg.preset;
  rows = presetRows(cfg.preset);
  renderRows();
  updateNote();
  setNow();
})(window.TD);

/* 공부 스톱워치: 과목 카드를 누르면 그 과목 시간이 흐르고, 다른 과목을 누르면 넘어간다.
   측정 중 상태(run.since)를 저장하므로 새로고침·탭 종료 후에도 이어서 센다.
   자정을 넘긴 측정은 날짜별로 나눠 기록한다. */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, U = TD.i18n.ui, $ = TD.$;
  var root = $("#tool"), KEY = "study-v1", LONG = 6 * 3600 * 1000;
  var COLORS = ["#e03131", "#1c7ed6", "#2f9e44", "#f08c00", "#7048e8", "#0c8599", "#d6336c", "#5c940d"];
  var st = TD.load(KEY, null) || {
    subjects: T.defaultSubjects.map(function (n, i) { return { id: "s" + i, name: n, c: i }; }),
    log: {}, run: null, last: null, seq: T.defaultSubjects.length
  };

  // 뽀모도로 모드 설정·오늘 세트 수 (예전 저장본엔 없음)
  function norm() { st.pomo = Object.assign({ on: false, len: "25-5", breakEnd: 0, sets: {} }, st.pomo || {}); }
  norm();
  if (st.pomo.breakEnd && st.pomo.breakEnd < Date.now() - 60000) st.pomo.breakEnd = 0; // 오래전에 끝난 휴식은 조용히 정리
  var pomoTo = null, breakDone = false;

  function save() { TD.save(KEY, st); }
  function dayStart(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function addLog(dateMs, id, sec) {
    var k = TD.dateKey(new Date(dateMs));
    st.log[k] = st.log[k] || {};
    st.log[k][id] = (st.log[k][id] || 0) + sec;
  }
  // 측정 중인 구간을 기록에 반영 (자정 기준으로 쪼갬)
  function commit(until) {
    if (!st.run) return;
    var a = st.run.since, b = until || Date.now();
    while (a < b) {
      var next = Math.min(b, dayStart(a) + 864e5);
      addLog(a, st.run.id, (next - a) / 1000);
      a = next;
    }
    st.run.since = b;
  }
  function liveSec(id) {
    var k = TD.dateKey(new Date()), v = (st.log[k] && st.log[k][id]) || 0;
    if (st.run && st.run.id === id) v += (Date.now() - Math.max(st.run.since, dayStart(Date.now()))) / 1000;
    return v;
  }
  function fmtH(sec) {
    sec = Math.floor(sec);
    return Math.floor(sec / 3600) + ":" + TD.pad(Math.floor(sec % 3600 / 60)) + ":" + TD.pad(sec % 60);
  }
  function subj(id) { return st.subjects.filter(function (s) { return s.id === id; })[0]; }

  function start(id) {
    TD.unlockAudio();
    if (st.run && st.run.id === id) return;
    var t0 = st.run ? st.run.t0 || st.run.since : Date.now(); // 과목을 바꿔도 이어지는 세션 시작 (commit 전에 읽는다)
    commit();
    if (!st.run) TD.track("timer_start", {});
    st.run = { id: id, since: Date.now(), t0: t0 };
    st.pomo.breakEnd = 0; breakDone = false; // 휴식 중에 시작하면 휴식은 끝
    st.last = id;
    save(); renderAll();
  }
  function pause() {
    if (!st.run) return;
    var mins = Math.round((Date.now() - (st.run.t0 || st.run.since)) / 60000);
    commit();
    if (mins >= 1) TD.track("timer_complete", { kind: "study", minutes: mins });
    st.run = null;
    save(); renderAll();
    // 멈출 때 오늘 합계가 5분 이상이면 칭찬 (삭제한 과목 기록 포함)
    var lg = st.log[TD.dateKey(new Date())] || {}, sum = 0;
    Object.keys(lg).forEach(function (id) { sum += lg[id]; });
    if (sum >= 300) TD.cheerDone("study", { time: TD.fmtHM(sum) });
  }
  /* ---------- 뽀모도로 모드 ----------
     켜 두면 한 세션(과목을 바꿔도 이어지는 t0 기준)이 집중 시간에 닿을 때 알림과 함께 자동으로 멈추고 휴식 카운트다운.
     휴식이 끝나도 저절로 다시 재지는 않는다 — 자리를 비운 시간이 순공에 들어가지 않게. */
  function pomoLen() { var p = st.pomo.len.split("-"); return { f: +p[0] * 60000, b: +p[1] * 60000 }; }
  function sessionStart() { return st.run ? st.run.t0 || st.run.since : 0; }
  function pomoDue(now) {
    return st.pomo.on && ((st.run && now - sessionStart() >= pomoLen().f) || (!st.run && st.pomo.breakEnd && now >= st.pomo.breakEnd));
  }
  // 끝나는 순간은 1회성 타이머로 잡는다 (반복 타이머보다 백그라운드 탭에서 덜 늦음). 250ms 표시 갱신이 보조.
  function pomoSchedule() {
    clearTimeout(pomoTo);
    if (!st.pomo.on) return;
    var now = Date.now(), at = st.run ? sessionStart() + pomoLen().f : (st.pomo.breakEnd > now ? st.pomo.breakEnd : 0);
    if (at) pomoTo = setTimeout(pomoCheck, Math.max(0, at - now) + 50);
  }
  function pomoCheck() {
    var now = Date.now(), L = pomoLen();
    if (!pomoDue(now)) return;
    if (st.run) {
      pause(); // 시간 반영·완료 이벤트는 pause가 처리
      var k = TD.dateKey(new Date()), lg = st.log[k] || {}, sum = 0;
      st.pomo.sets[k] = (st.pomo.sets[k] || 0) + 1;
      st.pomo.breakEnd = now + L.b;
      save();
      Object.keys(lg).forEach(function (id) { sum += lg[id]; });
      TD.play("bell", 0.7, 2);
      TD.notify("🍅 " + T.pomoFocus, T.pomoNotifyFocus.replace("{m}", L.f / 60000).replace("{b}", L.b / 60000));
      TD.cheerDone("focus", { n: st.pomo.sets[k], min: Math.round(sum / 60) });
    } else {
      st.pomo.breakEnd = 0; breakDone = true;
      save();
      TD.play("chime", 0.7, 2);
      TD.notify("☕ " + T.pomoBreak, T.pomoNotifyBreak);
    }
    renderAll();
  }
  function renderPomo() {
    var on = st.pomo.on, line = $("#pomoLine");
    line.hidden = !on; $("#pomoHint").hidden = !on; $("#pomoLen").disabled = !on;
    if (!on) return;
    var now = Date.now(), L = pomoLen(), sets = st.pomo.sets[TD.dateKey(new Date())] || 0, prog = 0, brk = false, txt;
    if (st.run) {
      var el = now - sessionStart();
      prog = el / L.f;
      txt = "🍅 " + T.pomoFocus + " " + TD.fmt(Math.max(0, (L.f - el) / 1000));
    } else if (st.pomo.breakEnd > now) {
      var left = st.pomo.breakEnd - now;
      brk = true; prog = 1 - left / L.b;
      txt = "☕ " + T.pomoBreak + " " + TD.fmt(left / 1000);
      $("#current").textContent = T.pomoBreakNow.replace("{m}", L.b / 60000);
      TD.setTitle("☕ " + TD.fmt(left / 1000));
    } else {
      txt = breakDone ? T.pomoBreakDone : T.pomoIdle.replace("{m}", L.f / 60000);
    }
    line.classList.toggle("break", brk);
    $("#pomoFill").style.width = (Math.min(1, Math.max(0, prog)) * 100).toFixed(1) + "%";
    $("#pomoText").textContent = txt;
    $("#pomoSets").textContent = sets ? "· " + T.pomoSets.replace("{n}", sets) : "";
    $("#pomoSkip").hidden = !brk;
    if (pomoDue(now)) pomoCheck(); // 예약 타이머가 늦었을 때 대비
  }

  function toggleMain() {
    if (st.run) pause();
    else if (st.last && subj(st.last)) start(st.last);
    else if (st.subjects[0]) start(st.subjects[0].id);
  }

  function renderSubjects() {
    $("#subjects").innerHTML = st.subjects.map(function (s) {
      var on = st.run && st.run.id === s.id;
      return '<div class="subject' + (on ? " on" : "") + '" style="--c:' + COLORS[s.c % COLORS.length] + '">' +
        '<button type="button" class="subject-main" data-id="' + s.id + '" aria-pressed="' + !!on + '">' +
        '<span class="subject-name"></span><span class="subject-time" data-t="' + s.id + '">0:00:00</span>' +
        '<span class="subject-state">' + (on ? "⏸" : "▶") + "</span></button>" +
        (on ? "" : '<button type="button" class="subject-del" data-del="' + s.id + '" aria-label="' + T.remove + '">×</button>') + "</div>";
    }).join("");
    // 이름은 사용자 입력이라 textContent로
    TD.$$(".subject-name", root).forEach(function (el, i) { el.textContent = st.subjects[i].name; });
  }
  function renderTimes() {
    var total = 0;
    st.subjects.forEach(function (s) {
      var v = liveSec(s.id);
      total += v;
      var el = root.querySelector('[data-t="' + s.id + '"]');
      if (el) el.textContent = fmtH(v);
    });
    // 삭제한 과목의 오늘 기록도 합계에는 포함
    var k = TD.dateKey(new Date()), lg = st.log[k] || {};
    Object.keys(lg).forEach(function (id) { if (!subj(id)) total += lg[id]; });
    $("#total").textContent = fmtH(total);
    var cur = st.run && subj(st.run.id);
    $("#current").textContent = cur ? "▶ " + cur.name : T.pickSubject;
    $("#mainBtn").textContent = st.run ? U.pause : (st.last && subj(st.last) ? U.resume + " · " + subj(st.last).name : U.start);
    root.classList.toggle("running", !!st.run);
    TD.setTitle(cur ? fmtH(total) + " " + cur.name : null);
    renderPomo();
  }
  function renderWeek() {
    var now = new Date(), days = [], max = 60, sum = 0, bySub = {};
    var wd = new Intl.DateTimeFormat(TD.lang, { weekday: "short" });
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), lg = st.log[TD.dateKey(d)] || {}, m = 0;
      Object.keys(lg).forEach(function (id) { m += lg[id]; bySub[id] = (bySub[id] || 0) + lg[id]; });
      m = Math.round(m / 60);
      days.push([d, m]); sum += m; if (m > max) max = m;
    }
    $("#week").innerHTML = days.map(function (x, i) {
      return '<div class="day' + (i === 6 ? " today" : "") + '" title="' + x[1] + T.minUnit + '"><div class="bar"><i style="height:' +
        Math.round(x[1] / max * 100) + '%"></i></div><b>' + (x[1] ? (x[1] >= 60 ? (x[1] / 60).toFixed(1) + "h" : x[1]) : "") + "</b><span>" + wd.format(x[0]) + "</span></div>";
    }).join("");
    $("#weekTotal").textContent = (sum / 60).toFixed(1) + T.hourUnit;
    var best = Object.keys(bySub).sort(function (a, b) { return bySub[b] - bySub[a]; })[0];
    $("#bestSub").textContent = best && subj(best) ? subj(best).name : "-";
  }
  function renderAll() {
    $("#todayLabel").textContent = new Intl.DateTimeFormat(TD.lang, { dateStyle: "full" }).format(new Date());
    renderSubjects(); renderTimes(); renderWeek();
    TD.keepAwake(!!st.run);
    pomoSchedule();
  }

  $("#subjects").addEventListener("click", function (e) {
    var del = e.target.closest("[data-del]");
    if (del) {
      if (confirm(T.removeConfirm)) {
        st.subjects = st.subjects.filter(function (s) { return s.id !== del.dataset.del; });
        save(); renderAll();
      }
      return;
    }
    var b = e.target.closest("[data-id]");
    if (!b) return;
    if (st.run && st.run.id === b.dataset.id) pause(); else start(b.dataset.id);
  });
  $("#addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("#newSub").value.trim();
    if (!name || st.subjects.length >= 12) return;
    st.subjects.push({ id: "s" + st.seq, name: name, c: st.seq });
    st.seq++;
    $("#newSub").value = "";
    save(); renderAll();
  });
  $("#mainBtn").addEventListener("click", toggleMain);
  $("#resetToday").addEventListener("click", function () {
    if (!confirm(T.resetConfirm)) return;
    if (st.run) st.run.since = Date.now();
    delete st.log[TD.dateKey(new Date())];
    save(); renderAll();
  });
  $("#pomoOn").checked = st.pomo.on;
  $("#pomoLen").value = st.pomo.len;
  $("#pomoOn").addEventListener("change", function () {
    st.pomo.on = this.checked;
    st.pomo.breakEnd = 0; breakDone = false;
    if (st.pomo.on) {
      TD.askNotify();
      if (st.run) st.run.t0 = Date.now(); // 측정 중에 켜면 집중 시간은 지금부터 센다
    }
    TD.track("pomo_mode", { on: st.pomo.on ? 1 : 0 });
    save(); renderAll();
  });
  $("#pomoLen").addEventListener("change", function () { st.pomo.len = this.value; save(); renderAll(); });
  $("#pomoSkip").addEventListener("click", function () { st.pomo.breakEnd = 0; breakDone = false; save(); renderAll(); });
  $("#fsBtn").addEventListener("click", function () { TD.toggleFullscreen(root); });
  TD.keys({ Space: toggleMain, KeyF: function () { TD.toggleFullscreen(root); } });

  // 측정을 켜 둔 채 오래 자리를 비웠다면 기록에 넣을지 묻는다
  if (st.run && Date.now() - st.run.since > LONG) {
    var hrs = ((Date.now() - st.run.since) / 3600000).toFixed(1);
    if (confirm(T.longRunConfirm.replace("{h}", hrs))) commit(); else st.run.since = Date.now();
    st.run = null;
    save();
  }
  // 기록은 최근 120일만 보관
  var keys = Object.keys(st.log).sort();
  while (keys.length > 120) delete st.log[keys.shift()];
  var pk = Object.keys(st.pomo.sets).sort();
  while (pk.length > 120) delete st.pomo.sets[pk.shift()];

  renderAll();
  setInterval(renderTimes, 250);
  // 날짜가 바뀌면 주간 그래프·오늘 표시 갱신
  var lastDay = TD.dateKey(new Date());
  setInterval(function () {
    var k = TD.dateKey(new Date());
    if (k !== lastDay) { lastDay = k; commit(); save(); renderAll(); }
  }, 30000);
  // 다른 탭에서 바꾼 기록 반영
  window.addEventListener("storage", function (e) { if (e.key === KEY) { st = TD.load(KEY, st); norm(); renderAll(); } });
})(window.TD);

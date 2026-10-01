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
    commit();
    st.run = { id: id, since: Date.now() };
    st.last = id;
    save(); renderAll();
  }
  function pause() {
    if (!st.run) return;
    commit();
    st.run = null;
    save(); renderAll();
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

  renderAll();
  setInterval(renderTimes, 250);
  // 날짜가 바뀌면 주간 그래프·오늘 표시 갱신
  var lastDay = TD.dateKey(new Date());
  setInterval(function () {
    var k = TD.dateKey(new Date());
    if (k !== lastDay) { lastDay = k; commit(); save(); renderAll(); }
  }, 30000);
  // 다른 탭에서 바꾼 기록 반영
  window.addEventListener("storage", function (e) { if (e.key === KEY) { st = TD.load(KEY, st); renderAll(); } });
})(window.TD);

/* 디데이 계산기: ① 기념일(100일·1주년…) ② 두 날짜 사이 일수 ③ 날짜 더하기/빼기.
   날짜는 모두 현지 자정 기준 정수 일수로 계산한다 (서머타임·시간대 오차 방지를 위해 UTC 기준 변환). */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, $ = TD.$;
  var root = $("#tool");
  var DAY_MS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 3000, 5000, 10000];
  var cfg = Object.assign({ tab: T.tabOrder[0], start: "", countFirst: true }, TD.load("dday-cfg", {}));

  // "YYYY-MM-DD" <-> UTC 일 번호
  function toDay(s) { if (!s) return null; var p = s.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; }
  function fromDay(n) { var d = new Date(n * 864e5); return d.getUTCFullYear() + "-" + TD.pad(d.getUTCMonth() + 1) + "-" + TD.pad(d.getUTCDate()); }
  function today() { var d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5; }
  function fmtDate(n) {
    var d = new Date(n * 864e5);
    return new Intl.DateTimeFormat(TD.lang, { year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(d);
  }
  function ddayLabel(diff) { return diff > 0 ? "D-" + diff : diff === 0 ? "D-DAY" : "D+" + (-diff); }
  function num(n) { return new Intl.NumberFormat(TD.lang).format(n); }
  function addYears(n, y) {
    var d = new Date(n * 864e5), m = d.getUTCMonth(), dd = d.getUTCDate();
    var t = new Date(Date.UTC(d.getUTCFullYear() + y, m, dd));
    if (t.getUTCMonth() !== m) t = new Date(Date.UTC(d.getUTCFullYear() + y, m + 1, 1)); // 2/29 → 3/1
    return t.getTime() / 864e5;
  }
  function save() { TD.save("dday-cfg", cfg); }

  /* ---------- 탭 ---------- */
  function renderTabs() {
    $("#tabs").innerHTML = T.tabOrder.map(function (k) {
      return '<button class="tab' + (k === cfg.tab ? " active" : "") + '" role="tab" data-tab="' + k + '">' + T.tabs[k] + "</button>";
    }).join("");
    TD.$$(".calc-panel", root).forEach(function (p) { p.hidden = p.dataset.panel !== cfg.tab; });
  }
  $("#tabs").addEventListener("click", function (e) {
    var b = e.target.closest(".tab");
    if (!b) return;
    cfg.tab = b.dataset.tab; save(); renderTabs();
  });

  /* ---------- ① 기념일 ---------- */
  function milestone() {
    var s = toDay($("#msStart").value), first = $("#msCountFirst").checked;
    cfg.start = $("#msStart").value; cfg.countFirst = first; save();
    if (s == null) { $("#msToday").textContent = T.pickStart; $("#msTodaySub").textContent = ""; $("#msRows").innerHTML = ""; return; }
    var t = today(), nth = t - s + (first ? 1 : 0);
    $("#msToday").textContent = nth > 0 ? T.todayIs.replace("{n}", num(nth)) : T.notYet.replace("{n}", num(s - t));
    $("#msTodaySub").textContent = T.since.replace("{date}", fmtDate(s));
    var rows = DAY_MS.map(function (n) { return { label: T.dayN.replace("{n}", num(n)), day: s + n - (first ? 1 : 0) }; });
    for (var y = 1; y <= 10; y++) rows.push({ label: T.yearN.replace("{n}", y), day: addYears(s, y) });
    rows.sort(function (a, b) { return a.day - b.day; });
    var nextMarked = false;
    $("#msRows").innerHTML = rows.map(function (r) {
      var diff = r.day - t, cls = diff < 0 ? "past" : "";
      if (diff >= 0 && !nextMarked) { cls = "next"; nextMarked = true; }
      return '<tr class="' + cls + '"><td>' + r.label + "</td><td>" + fmtDate(r.day) + "</td><td>" + ddayLabel(diff) + "</td></tr>";
    }).join("");
  }

  /* ---------- ② 두 날짜 사이 ---------- */
  function between() {
    var a = toDay($("#bwFrom").value), b = toDay($("#bwTo").value);
    if (a == null || b == null) { $("#bwResult").textContent = T.pickBoth; $("#bwSub").textContent = ""; return; }
    var diff = b - a, inc = $("#bwInclusive").checked ? (diff >= 0 ? 1 : -1) : 0, n = diff + inc, abs = Math.abs(n);
    $("#bwResult").textContent = T.daysResult.replace("{n}", num(n));
    var w = Math.floor(abs / 7), r = abs % 7;
    // 개월 수: 같은 날짜 기준 달 차이
    var da = new Date(Math.min(a, b) * 864e5), db = new Date(Math.max(a, b) * 864e5);
    var months = (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + db.getUTCMonth() - da.getUTCMonth() - (db.getUTCDate() < da.getUTCDate() ? 1 : 0);
    $("#bwSub").textContent = T.weeksResult.replace("{w}", num(w)).replace("{d}", r) + " · " + T.monthsResult.replace("{m}", num(months)) +
      " · " + T.hoursResult.replace("{h}", num(abs * 24));
  }

  /* ---------- ③ 더하기/빼기 ---------- */
  function addDays() {
    var base = toDay($("#adBase").value), n = Math.round(+$("#adDays").value || 0) * +$("#adDir").value;
    if (base == null) { $("#adResult").textContent = T.pickBase; $("#adSub").textContent = ""; return; }
    var r = base + n;
    $("#adResult").textContent = fmtDate(r);
    $("#adSub").textContent = T.fromToday.replace("{dday}", ddayLabel(r - today()));
  }

  ["msStart", "msCountFirst"].forEach(function (id) { $("#" + id).addEventListener("input", milestone); $("#" + id).addEventListener("change", milestone); });
  ["bwFrom", "bwTo", "bwInclusive"].forEach(function (id) { $("#" + id).addEventListener("input", between); $("#" + id).addEventListener("change", between); });
  ["adBase", "adDays", "adDir"].forEach(function (id) { $("#" + id).addEventListener("input", addDays); $("#" + id).addEventListener("change", addDays); });

  // 공유 링크: ?start=YYYY-MM-DD 로 기념일 탭 바로 열기
  var q = new URLSearchParams(location.search);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("start") || "")) { cfg.start = q.get("start"); cfg.tab = "milestone"; }

  var t0 = fromDay(today());
  if (T.tabOrder.indexOf(cfg.tab) < 0) cfg.tab = T.tabOrder[0];
  $("#msStart").value = cfg.start || "";
  $("#msCountFirst").checked = cfg.countFirst !== false;
  $("#bwFrom").value = t0;
  $("#bwTo").value = T.defaultTo || fromDay(today() + 100);
  $("#adBase").value = t0;
  renderTabs(); milestone(); between(); addDays();
})(window.TD);

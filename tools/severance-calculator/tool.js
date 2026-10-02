/* 퇴직금 계산기 — 고용노동부 퇴직금 계산기와 같은 방식
   - 퇴직일 = 마지막 근무일 다음날, 재직일수 = 퇴직일 − 입사일
   - 1일 평균임금 = (최근 3개월 임금총액 + 연간상여금×3/12 + 연차수당×3/12) ÷ 퇴직일 이전 3개월의 달력 일수
   - 퇴직금 = 1일 평균임금 × 30 × 재직일수 ÷ 365 (재직 1년 이상) — 세전 */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, $ = TD.$, DAY = 86400000;
  var cfg = Object.assign({ start: "", end: "", monthly: 300, bonus: 0, leave: 0 }, TD.load("severance-cfg", {}));

  function won(n) { return new Intl.NumberFormat("ko-KR").format(Math.round(n)) + T.won; }
  function num(n) { return new Intl.NumberFormat("ko-KR").format(n); }
  function iso(d) { return d.getFullYear() + "-" + TD.pad(d.getMonth() + 1) + "-" + TD.pad(d.getDate()); }
  function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; }
  function addMonths(d, n) { // 말일 보정: 5/31에서 3개월 전 → 2/28(29)
    var r = new Date(d.getFullYear(), d.getMonth() + n, 1);
    r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
    return r;
  }
  function days(a, b) { return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY); }

  function render() {
    cfg = { start: $("#start").value, end: $("#end").value, monthly: Math.max(0, +$("#monthly").value || 0),
            bonus: Math.max(0, +$("#bonus").value || 0), leave: Math.max(0, +$("#leave").value || 0) };
    TD.save("severance-cfg", cfg);
    var s = parse(cfg.start), e = parse(cfg.end);
    if (!s || !e || !cfg.monthly) { $("#net").textContent = "-"; $("#netSub").textContent = T.enter; $("#breakdown").innerHTML = ""; return; }
    var worked = days(s, e);
    if (worked <= 0) { $("#net").textContent = "-"; $("#netSub").textContent = T.badDates; $("#breakdown").innerHTML = ""; return; }
    var pDays = days(addMonths(e, -3), e);
    var wage3 = cfg.monthly * 10000 * 3, bonus3 = cfg.bonus * 10000 * 3 / 12, leave3 = cfg.leave * 10000 * 3 / 12;
    var avg = (wage3 + bonus3 + leave3) / pDays;
    var pay = avg * 30 * worked / 365;
    var years = Math.floor(worked / 365), rest = worked - years * 365;
    var ok = e >= addMonths(s, 12); // 1년 = 입사일 같은 날짜까지 (윤년이 끼면 366일)
    var result = ok ? won(pay) : "0" + T.won;
    $("#net").textContent = result;
    $("#netSub").textContent = (ok ? "" : T.under1y + " · ") + T.period.replace("{d}", num(worked)).replace("{y}", years).replace("{r}", rest);
    var lines = [
      [T.workedDays, T.daysN.replace("{n}", num(worked))], [T.wage3, won(wage3)], [T.bonus3, won(bonus3)], [T.leave3, won(leave3)],
      [T.pDays, T.daysN.replace("{n}", pDays)], [T.avgWage, won(avg), "strong"],
      [T.formula, won(avg) + " × 30 × " + num(worked) + "/365"], [T.result, result, "net"]
    ];
    $("#breakdown").innerHTML = lines.map(function (l) { return '<tr class="' + (l[2] || "") + '"><th>' + l[0] + "</th><td>" + l[1] + "</td></tr>"; }).join("");
  }

  var today = new Date();
  if (!cfg.end) cfg.end = iso(today);
  if (!cfg.start) cfg.start = iso(addMonths(today, -36));
  ["start", "end", "monthly", "bonus", "leave"].forEach(function (id) {
    $("#" + id).value = cfg[id];
    $("#" + id).addEventListener("input", render); $("#" + id).addEventListener("change", render);
  });
  render();
})(window.TD);

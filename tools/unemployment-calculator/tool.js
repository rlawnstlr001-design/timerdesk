/* 실업급여(구직급여) 계산기 — 2026년 기준
   - 구직급여일액 = 이직 전 평균임금일액 × 60%, 상한 68,100원(기초일액 상한 113,500원 × 60%)
   - 하한 = 최저임금 10,320원 × 80% × 1일 소정근로시간(최대 8시간) → 8시간이면 66,048원
   - 소정급여일수: 고용보험법 [별표 1] (2019.10.1~) — 50세 미만 / 50세 이상·장애인 × 피보험기간
   - 평균임금일액 = 3개월 임금 ÷ 3개월 달력 일수 (평균 91일로 근사) */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, $ = TD.$;
  var MIN_WAGE = 10320, CAP = 68100, P_DAYS = 91;
  var TABLE = { under: [120, 150, 180, 210, 240], over: [120, 180, 210, 240, 270] };
  var cfg = Object.assign({ monthly: 300, dayHours: 8, insured: 1, over50: false }, TD.load("unemp-cfg", {}));

  function won(n) { return new Intl.NumberFormat("ko-KR").format(Math.round(n)) + T.won; }

  function render() {
    cfg = { monthly: Math.max(0, +$("#monthly").value || 0), dayHours: +$("#dayHours").value, insured: +$("#insured").value, over50: $("#over50").checked };
    TD.save("unemp-cfg", cfg);
    if (!cfg.monthly) { $("#net").textContent = "-"; $("#netSub").textContent = T.enter; $("#breakdown").innerHTML = ""; return; }
    var avg = cfg.monthly * 10000 * 3 / P_DAYS;
    var raw = avg * 0.6;
    var floor = Math.floor(MIN_WAGE * 0.8 * Math.min(cfg.dayHours, 8));
    var daily = Math.floor(Math.min(CAP, Math.max(raw, floor)));
    var note = raw >= CAP ? T.capped : raw <= floor ? T.floored : T.normal;
    var n = TABLE[cfg.over50 ? "over" : "under"][cfg.insured];
    $("#net").textContent = won(daily * n);
    $("#netSub").textContent = T.sub.replace("{d}", won(daily)).replace("{n}", n).replace("{m}", won(daily * 30));
    var lines = [
      [T.avgDaily, won(avg)], [T.raw60, won(raw)], [T.capLine, won(CAP)], [T.floorLine, won(floor)],
      [T.daily, won(daily) + " (" + note + ")", "strong"], [T.daysLine, T.daysN.replace("{n}", n)],
      [T.monthly30, won(daily * 30)], [T.total, won(daily * n), "net"]
    ];
    $("#breakdown").innerHTML = lines.map(function (l) { return '<tr class="' + (l[2] || "") + '"><th>' + l[0] + "</th><td>" + l[1] + "</td></tr>"; }).join("");
  }

  var h = "";
  for (var i = 8; i >= 1; i--) h += '<option value="' + i + '">' + T.hoursN.replace("{n}", i) + "</option>";
  $("#dayHours").innerHTML = h;
  $("#insured").innerHTML = T.insuredOpts.map(function (x, k) { return '<option value="' + k + '">' + x + "</option>"; }).join("");
  $("#monthly").value = cfg.monthly; $("#dayHours").value = String(cfg.dayHours); $("#insured").value = String(cfg.insured); $("#over50").checked = !!cfg.over50;
  ["monthly", "dayHours", "insured", "over50"].forEach(function (id) { $("#" + id).addEventListener("input", render); $("#" + id).addEventListener("change", render); });
  render();
})(window.TD);

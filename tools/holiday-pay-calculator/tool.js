/* 주휴수당 계산기 (2026년 최저임금 10,320원)
   - 1주 소정근로시간 15시간 이상 + 소정근로일 개근 → 주휴수당
   - 주휴시간 = min(주 소정근로시간, 40) ÷ 40 × 8, 주휴수당 = 주휴시간 × 시급
   - 월 환산은 1달 = 365 ÷ 7 ÷ 12 ≈ 4.345주 (주 40시간이면 월 209시간 — 최저임금 고시와 같은 기준), 시간은 반올림 */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, $ = TD.$;
  var MIN_WAGE = 10320, WEEKS = 365 / 7 / 12;
  var cfg = Object.assign({ wage: MIN_WAGE, dayHours: 8, days: 5 }, TD.load("holiday-cfg", {}));

  function won(n) { return new Intl.NumberFormat("ko-KR").format(Math.round(n)) + T.won; }
  function hrs(n) { return T.hours.replace("{n}", +n.toFixed(2)); }

  function render() {
    cfg = { wage: Math.max(0, +$("#wage").value || 0), dayHours: Math.max(0, +$("#dayHours").value || 0), days: +$("#days").value };
    TD.save("holiday-cfg", cfg);
    var week = cfg.dayHours * cfg.days;
    $("#warn").textContent = cfg.wage && cfg.wage < MIN_WAGE ? T.belowMin.replace("{w}", won(MIN_WAGE)) : "";
    if (!cfg.wage || !week) { $("#net").textContent = "-"; $("#netSub").textContent = T.enter; $("#breakdown").innerHTML = ""; return; }
    var eligible = week >= 15;
    var hHours = eligible ? Math.min(week, 40) / 40 * 8 : 0;
    var pay = Math.round(hHours * cfg.wage);
    var monthHours = Math.round((week + hHours) * WEEKS); // 고시 관행대로 시간 단위 반올림 (40시간 → 209시간)
    $("#net").textContent = won(pay);
    $("#netSub").textContent = eligible ? T.monthlyHoliday.replace("{v}", won(Math.round(hHours * WEEKS) * cfg.wage)) : T.notEligible.replace("{h}", hrs(week));
    var lines = [
      [T.weekHours, hrs(week)], [T.holidayHours, hrs(hHours)], [T.weeklyBase, won(week * cfg.wage)],
      [T.weeklyPay, won(pay), "strong"], [T.monthHours, hrs(monthHours)], [T.monthlyTotal, won(monthHours * cfg.wage), "net"]
    ];
    $("#breakdown").innerHTML = lines.map(function (l) { return '<tr class="' + (l[2] || "") + '"><th>' + l[0] + "</th><td>" + l[1] + "</td></tr>"; }).join("");
  }

  var o = "";
  for (var d = 1; d <= 7; d++) o += '<option value="' + d + '">' + T.daysN.replace("{n}", d) + "</option>";
  $("#days").innerHTML = o;
  $("#wage").value = cfg.wage; $("#dayHours").value = cfg.dayHours; $("#days").value = String(cfg.days);
  ["wage", "dayHours", "days"].forEach(function (id) { $("#" + id).addEventListener("input", render); $("#" + id).addEventListener("change", render); });
  render();
})(window.TD);

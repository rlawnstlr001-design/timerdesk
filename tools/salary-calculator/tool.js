/* 연봉 실수령액 계산기 (2026년 기준)
   - 4대보험: 국민연금 4.75%(기준소득월액 41만~659만원, 2026.7~2027.6), 건강보험 3.595%,
     장기요양 = 건강보험료 × 0.9448/7.19, 고용보험 0.9% — 모두 10원 미만 절사
   - 소득세: 근로소득 간이세액표(2026.2.27 개정, data.js) + 8~20세 자녀 공제, 지방소득세 10% */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, $ = TD.$, TAX = window.TD_TAX;
  var R = { pension: 0.0475, health: 0.03595, care: 0.009448 / 0.0719, employ: 0.009, pMin: 410000, pMax: 6590000 };
  var cfg = Object.assign({ annual: 4000, nontax: 20, family: 1, kids: 0, ratio: "1", severance: false }, TD.load("salary-cfg", {}));

  function floor10(n) { return Math.floor(n / 10) * 10; }
  function won(n) { return new Intl.NumberFormat("ko-KR").format(Math.round(n)) + T.won; }

  // 간이세액표 월 소득세 (월급여액: 원, 비과세 제외)
  function tableTax(pay, family) {
    var x = pay / 1000, f = Math.min(Math.max(family, 1), 11) - 1, rows = TAX.rows;
    if (x < rows[0][0]) return 0;
    if (x < 10000) {
      var lo = 0, hi = rows.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (rows[mid][0] <= x) lo = mid; else hi = mid - 1; }
      return rows[lo][2 + f];
    }
    var base = TAX.ten[f], over = (x - 10000) * 1000;
    if (x <= 14000) return base + over * 0.98 * 0.35 + 25000;
    if (x <= 28000) return base + 1397000 + (x - 14000) * 1000 * 0.98 * 0.38;
    if (x <= 30000) return base + 6610600 + (x - 28000) * 1000 * 0.98 * 0.40;
    if (x <= 45000) return base + 7394600 + (x - 30000) * 1000 * 0.40;
    if (x <= 87000) return base + 13394600 + (x - 45000) * 1000 * 0.42;
    return base + 31034600 + (x - 87000) * 1000 * 0.45;
  }
  function kidCredit(n) { return n <= 0 ? 0 : n === 1 ? 20830 : 45830 + Math.max(0, n - 2) * 33330; }

  function calc(annualWon, nontaxWon, family, kids, ratio, severance) {
    var gross = annualWon / (severance ? 13 : 12);
    var taxable = Math.max(0, gross - nontaxWon);
    var pension = floor10(Math.min(Math.max(Math.floor(taxable / 1000) * 1000, R.pMin), R.pMax) * R.pension);
    if (taxable <= 0) pension = 0;
    var health = floor10(taxable * R.health);
    var care = floor10(health * R.care);
    var employ = floor10(taxable * R.employ);
    var income = floor10(Math.max(0, tableTax(taxable, family) - kidCredit(kids)) * ratio);
    var local = floor10(income * 0.1);
    var deduct = pension + health + care + employ + income + local;
    return { gross: gross, pension: pension, health: health, care: care, employ: employ, income: income, local: local, deduct: deduct, net: gross - deduct };
  }

  function read() {
    cfg = {
      annual: Math.max(0, +$("#annual").value || 0), nontax: Math.max(0, +$("#nontax").value || 0),
      family: +$("#family").value, kids: +$("#kids").value, ratio: $("#ratio").value, severance: $("#severance").checked
    };
    TD.save("salary-cfg", cfg);
  }

  function render() {
    read();
    if (!cfg.annual) { $("#net").textContent = "-"; $("#netSub").textContent = T.enterAnnual; $("#breakdown").innerHTML = ""; return; }
    var r = calc(cfg.annual * 10000, cfg.nontax * 10000, cfg.family, cfg.kids, +cfg.ratio, cfg.severance);
    $("#net").textContent = won(r.net);
    $("#netSub").textContent = T.yearNet.replace("{v}", won(r.net * 12)) + " · " + T.deductRate.replace("{p}", (r.deduct / r.gross * 100).toFixed(1));
    var lines = [
      [T.gross, r.gross, "strong"], [T.pension, r.pension], [T.health, r.health], [T.care, r.care], [T.employ, r.employ],
      [T.incomeTax, r.income], [T.localTax, r.local], [T.totalDeduct, r.deduct, "strong"], [T.monthlyNet, r.net, "net"]
    ];
    $("#breakdown").innerHTML = lines.map(function (l) {
      return '<tr class="' + (l[2] || "") + '"><th>' + l[0] + "</th><td>" + (l[2] === "strong" || l[2] === "net" || !l[1] ? "" : "−") + won(l[1]) + "</td></tr>";
    }).join("");
    renderByAnnual();
  }

  // 같은 조건으로 연봉 구간별 실수령액 표
  function renderByAnnual() {
    var html = "";
    for (var a = 2400; a <= 15000; a += a < 6000 ? 200 : a < 10000 ? 500 : 1000) {
      var r = calc(a * 10000, cfg.nontax * 10000, cfg.family, cfg.kids, +cfg.ratio, cfg.severance);
      html += '<tr' + (a === cfg.annual ? ' class="hl"' : "") + "><td>" + T.manwon.replace("{n}", new Intl.NumberFormat("ko-KR").format(a)) +
        "</td><td>" + won(r.gross) + "</td><td>" + won(r.deduct) + "</td><td><b>" + won(r.net) + "</b></td></tr>";
    }
    $("#byAnnual").innerHTML = html;
  }

  var fam = "", kid = "";
  for (var i = 1; i <= 11; i++) fam += '<option value="' + i + '">' + T.people.replace("{n}", i) + (i === 1 ? " (" + T.selfOnly + ")" : "") + "</option>";
  for (var k = 0; k <= 6; k++) kid += '<option value="' + k + '">' + T.people.replace("{n}", k) + "</option>";
  $("#family").innerHTML = fam;
  $("#kids").innerHTML = kid;

  // 공유 링크 ?a=연봉(만원)
  var q = new URLSearchParams(location.search);
  if (+q.get("a") > 0) cfg.annual = Math.min(100000, +q.get("a"));

  $("#annual").value = cfg.annual;
  $("#nontax").value = cfg.nontax;
  $("#family").value = String(cfg.family);
  $("#kids").value = String(cfg.kids);
  $("#ratio").value = String(cfg.ratio);
  $("#severance").checked = !!cfg.severance;
  ["annual", "nontax", "family", "kids", "ratio", "severance"].forEach(function (id) {
    $("#" + id).addEventListener("input", render);
    $("#" + id).addEventListener("change", render);
  });
  render();
})(window.TD);

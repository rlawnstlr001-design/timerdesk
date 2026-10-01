/* 나이 계산기: 만 나이(국제 기준) · 연 나이 · 세는 나이 · 살아온 날 · 다음 생일 · 띠 · 별자리.
   2월 29일생은 평년에 3월 1일을 생일로 본다. */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, $ = TD.$;
  // 별자리 시작일 (월, 일) — 염소자리부터
  var SIGNS = [[1, 20, "aquarius"], [2, 19, "pisces"], [3, 21, "aries"], [4, 20, "taurus"], [5, 21, "gemini"], [6, 22, "cancer"],
    [7, 23, "leo"], [8, 23, "virgo"], [9, 23, "libra"], [10, 23, "scorpio"], [11, 22, "sagittarius"], [12, 22, "capricorn"]];
  var ANIMALS = ["rat", "ox", "tiger", "rabbit", "dragon", "snake", "horse", "goat", "monkey", "rooster", "dog", "pig"];

  function parse(s) { if (!s) return null; var p = s.split("-"); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function utc(o) { return Date.UTC(o.y, o.m - 1, o.d) / 864e5; }
  function num(n) { return new Intl.NumberFormat(TD.lang).format(n); }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  // 해당 연도의 생일 (2/29 → 평년 3/1)
  function bdayIn(b, y) { return b.m === 2 && b.d === 29 && !isLeap(y) ? { y: y, m: 3, d: 1 } : { y: y, m: b.m, d: b.d }; }
  function cmp(a, b) { return utc(a) - utc(b); }

  function ymd(b, t) {
    // b부터 t까지 년·월·일 차이
    var y = t.y - b.y, m = t.m - b.m, d = t.d - b.d;
    if (d < 0) { m--; d += new Date(Date.UTC(t.y, t.m - 1, 0)).getUTCDate(); }
    if (m < 0) { y--; m += 12; }
    return { y: y, m: m, d: d };
  }
  function sign(b) {
    var s = "capricorn";
    SIGNS.forEach(function (x) { if (b.m > x[0] || (b.m === x[0] && b.d >= x[1])) s = x[2]; });
    if (b.m === 1 && b.d < 20) s = "capricorn";
    return s;
  }
  function card(label, value, sub) {
    return '<div class="result-card"><small>' + label + "</small><b>" + value + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + "</div>";
  }

  function calc() {
    var b = parse($("#birth").value), t = parse($("#base").value);
    TD.save("age-birth", $("#birth").value);
    if (!b || !t) { $("#ageMain").textContent = "-"; $("#ageDetail").textContent = T.pickBirth; $("#cards").innerHTML = ""; return; }
    if (cmp(t, b) < 0) { $("#ageMain").textContent = "-"; $("#ageDetail").textContent = T.futureBirth; $("#cards").innerHTML = ""; return; }
    var age = t.y - b.y - (cmp(t, bdayIn(b, t.y)) < 0 ? 1 : 0);
    var diff = ymd(b, t), lived = utc(t) - utc(b);
    var isToday = cmp(bdayIn(b, t.y), t) === 0, next = bdayIn(b, t.y);
    if (cmp(next, t) < 0) next = bdayIn(b, t.y + 1);
    var toNext = utc(next) - utc(t);
    var nextDate = new Intl.DateTimeFormat(TD.lang, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(utc(next) * 864e5));

    $("#ageMain").textContent = T.ageUnit.replace("{n}", age);
    $("#ageDetail").textContent = (isToday ? "🎉 " + T.happyBirthday + " · " : "") + T.ymd.replace("{y}", diff.y).replace("{m}", diff.m).replace("{d}", diff.d);

    var html = "";
    // 연 나이는 한국, 세는 나이(数え年·虚岁)는 한·일·중 — 언어 파일에서 켠다
    if (T.showKoreanAges) html += card(T.yearAge, T.ageUnit.replace("{n}", t.y - b.y), T.yearAgeSub);
    if (T.showKoreanAges || T.showCountingAge) html += card(T.countingAge, T.ageUnit.replace("{n}", t.y - b.y + 1), T.countingAgeSub);
    html += card(T.daysLived, T.daysUnit.replace("{n}", num(lived)), T.weeksUnit.replace("{n}", num(Math.floor(lived / 7))));
    html += card(T.nextBirthday, isToday ? "D-DAY" : "D-" + toNext, nextDate + " · " + T.turns.replace("{n}", age + (isToday ? 0 : 1)));
    // 띠: 양력 연도 기준 (설날 이전 출생은 전년도 띠일 수 있음)
    html += card(T.chineseZodiac, T.animals[ANIMALS[((b.y - 4) % 12 + 12) % 12]], T.zodiacNote);
    html += card(T.westernZodiac, T.signs[sign(b)], "");
    $("#cards").innerHTML = html;
  }

  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + TD.pad(d.getMonth() + 1) + "-" + TD.pad(d.getDate()); }
  $("#birth").addEventListener("input", calc);
  $("#base").addEventListener("input", calc);
  $("#todayBtn").addEventListener("click", function () { $("#base").value = todayStr(); calc(); });

  $("#birth").max = todayStr();
  $("#birth").value = TD.load("age-birth", "") || "";
  $("#base").value = todayStr();
  calc();
})(window.TD);

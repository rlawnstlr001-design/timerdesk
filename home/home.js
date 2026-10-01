/* 첫 화면 위젯: 큰 디지털 시계 + 바로 시작 타이머 (프리셋 버튼 → 그 자리에서 카운트다운) */
(function (TD) {
  "use strict";

  var T = TD.i18n.t, U = TD.i18n.ui, $ = TD.$, pad = TD.pad;
  var root = $("#tool"), PRESETS = [1, 3, 5, 10, 15, 25, 30, 60];
  var dateFmt = new Intl.DateTimeFormat(TD.lang, { dateStyle: "full" });
  var ampmFmt = U.clock24 ? null : new Intl.DateTimeFormat(TD.lang, { hour: "numeric", hour12: true });
  var cd = new TD.Countdown({ onTick: renderTimer, onDone: done });
  var lastSec = -1;

  function renderClock() {
    var now = new Date();
    if (now.getSeconds() === lastSec) return;
    lastSec = now.getSeconds();
    var h = now.getHours(), ap = "";
    if (ampmFmt) {
      // 12시간제 언어: 시는 1~12, 오전/오후 표기는 해당 언어 형식에서 가져온다
      var part = ampmFmt.formatToParts(now).filter(function (p) { return p.type === "dayPeriod"; })[0];
      ap = part ? part.value : "";
      h = h % 12 || 12;
    }
    var s = (ampmFmt ? h : pad(h)) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
    $("#hcTime").textContent = s;
    $("#hcAmPm").textContent = ap;
    $("#hcDate").textContent = dateFmt.format(now);
    if (!cd.running && !(cd.remaining() > 0 && cd.remaining() < cd.total)) TD.setTitle(s);
  }

  function renderTimer(rem) {
    $("#hcRemain").textContent = TD.fmt(rem);
    $("#hcBar").style.width = (cd.total ? (1 - rem / cd.total) * 100 : 0).toFixed(2) + "%";
    if (cd.running) TD.setTitle(TD.fmt(rem) + " ⏱");
  }

  function startMin(m) {
    TD.unlockAudio();
    root.classList.remove("done");
    cd.set(m * 60);
    cd.start();
    $("#hcRun").hidden = false;
    $("#hcPause").textContent = U.pause;
    root.classList.add("running");
    TD.keepAwake(true);
  }
  function stop() {
    cd.set(0);
    $("#hcRun").hidden = true;
    root.classList.remove("running", "done");
    TD.keepAwake(!!document.fullscreenElement);
    lastSec = -1; renderClock();
  }
  function done() {
    TD.play("bell", 0.8, 3);
    TD.notify("⏱ TimerDesk", T.timeUp);
    root.classList.add("done");
    $("#hcRemain").textContent = T.timeUp;
    $("#hcPause").textContent = U.reset;
    root.classList.remove("running");
  }

  $("#hcPresets").innerHTML = PRESETS.map(function (m) {
    return '<button type="button" class="chip" data-m="' + m + '">' + m + T.minShort + "</button>";
  }).join("");
  $("#hcPresets").addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (b) startMin(+b.dataset.m);
  });
  $("#hcCancel").addEventListener("click", stop);
  $("#hcPause").addEventListener("click", function () {
    if (root.classList.contains("done")) { startMin(cd.total / 60 || 1); return; }
    if (cd.running) { cd.pause(); $("#hcPause").textContent = U.resume; }
    else { cd.start(); $("#hcPause").textContent = U.pause; }
  });
  $("#fsBtn").addEventListener("click", function () { TD.toggleFullscreen(root); });
  document.addEventListener("fullscreenchange", function () { TD.keepAwake(!!document.fullscreenElement || cd.running); });
  TD.keys({ KeyF: function () { TD.toggleFullscreen(root); } });

  renderClock();
  setInterval(renderClock, 200);
})(window.TD);

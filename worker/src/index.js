/* TimerDesk 서버시간 중계 (Cloudflare Worker)
   GET /now                 → { now }  : Cloudflare 엣지 시계(NTP 동기) — 기기 시계 오차 측정용
   GET /server?url=<주소>   → { host, offset, err, coarseErr, rtt, samples, now }
     offset = (대상 서버 시각) − (엣지 시각), ms. Date 헤더는 1초 단위라 ① 연속 요청으로 '초가 바뀌는 순간'을
     대략 잡고 ② 다음 초 경계에 요청을 시간차로 몰아 보내 좁힌다(10/02, 오차 ±100~350 → ±20~70ms). err = ± 추정 오차(ms).
   남용 방지: http(s)·공개 호스트만, 결과는 호스트별 20초 캐시(같은 사이트를 여러 명이 봐도 대상에 요청이 몰리지 않게). */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};
const MAX_REQ = 30;        // 1단계 최대 요청 수 (+ 정밀 2단계 6×2, 리다이렉트 4 — 무료 플랜 서브요청 50 미만)
const GAP_MS = 30;         // 요청 간 최소 간격 → 오차 ±15~30ms
const CACHE_SEC = 20;

const UA = "Mozilla/5.0 (compatible; TimerDesk-ServerTime/1.0; +https://timerdesk.com)";
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: CORS });

function parseTarget(raw) {
  if (!raw) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  // IP 직접 지정·내부 이름 차단 (공개 도메인만)
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || h.endsWith(".local") || h === "localhost") return null;
  return new URL(u.protocol + "//" + u.host + "/");
}

async function hit(url) {
  // 매 요청에 무작위 값을 붙여 CDN 캐시를 피한다 (캐시된 응답의 Date는 과거 시각에 멈춰 있다)
  const u = url + (url.includes("?") ? "&" : "?") + "_td=" + Math.random().toString(36).slice(2, 10);
  const h = { "Cache-Control": "no-cache", Pragma: "no-cache", "User-Agent": UA };
  const t0 = Date.now();
  let r = await fetch(u, { method: "HEAD", redirect: "manual", headers: h });
  if (r.status === 405 || r.status === 501) { // HEAD 미지원 → GET (본문은 읽지 않음)
    r = await fetch(u, { method: "GET", redirect: "manual", headers: h });
    try { r.body && r.body.cancel(); } catch { /* 무시 */ }
  }
  const t1 = Date.now();
  const d = r.headers.get("date");
  return { t0, t1, mid: (t0 + t1) / 2, s: d ? Date.parse(d) : NaN, status: r.status, loc: r.headers.get("location") };
}

// 리다이렉트를 따라가 실제 페이지 주소를 찾는다 (최대 4번)
async function resolve(url) {
  let cur = url;
  for (let i = 0; i < 4; i++) {
    const r = await hit(cur);
    if (r.status >= 300 && r.status < 400 && r.loc) {
      const next = new URL(r.loc, cur);
      if (!/^https?:$/.test(next.protocol)) break;
      next.search = ""; next.hash = "";
      cur = next.href;
    } else break;
  }
  return cur;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 측정 원리 (NTP식 구간 교집합)
   응답 하나 = "엣지 시각 t0~t1 사이 어느 순간(T)에 서버 시계가 s초(s ~ s+999ms)였다".
   편도 지연은 최소 a(= 가장 빠른 왕복의 45%) 이상이라 T ∈ [t0+a, t1−a].
   → 오프셋 θ(서버−엣지) ∈ [s − (t1−a), s + 1000 − (t0+a)]. 모든 응답의 구간을 겹쳐 남는 [lo, hi]가 답,
   중앙값이 offset, 반폭이 오차. 왕복이 흔들린 응답은 구간이 넓어 자동으로 덜 반영된다. */
function solve(samples) {
  const a = Math.min(...samples.map((x) => x.t1 - x.t0)) * 0.45;
  let lo = -Infinity, hi = Infinity;
  for (const x of samples) {
    lo = Math.max(lo, x.s - (x.t1 - a));
    hi = Math.min(hi, x.s + 1000 - (x.t0 + a));
  }
  // 교집합이 비면(경로가 한쪽으로 크게 치우친 경우) 겹치지 않은 폭만큼 오차를 키워 보수적으로 낸다
  return { offset: (lo + hi) / 2, err: Math.abs(hi - lo) / 2 + (hi < lo ? 10 : 0) };
}

// 1단계: 초가 바뀔 때까지 ~30ms 간격 연속 요청 (경계 위치를 왕복시간 절반 정도로 잡는다)
async function coarse(url, samples) {
  const deadline = samples[0].t1 + 1300; // 1초 경계는 반드시 이 안에 온다
  while (samples.length < MAX_REQ && Date.now() < deadline) {
    const prev = samples[samples.length - 1];
    const wait = Math.max(0, GAP_MS - (prev.t1 - prev.t0));
    if (wait) await sleep(wait);
    const cur = await hit(url);
    if (isNaN(cur.s)) return false;
    samples.push(cur);
    if (cur.s > prev.s) return true;
  }
  return false; // 경계 못 찾음 = 캐시된 응답
}

// 2·3단계: 현재 추정으로 다음 초 경계(엣지 시각)를 예측해, 응답 중간 시각이 경계 ±W에 고르게 떨어지도록
// 요청 6개를 시간차로 동시에 보낸다 (Workers 동시 연결 한도 6). 경계를 가로지른 응답이 구간을 좁힌다.
async function refine(url, samples, est) {
  const N = 6, W = est.err * 1.2 + 8;
  const half = samples.reduce((m, x) => Math.min(m, x.t1 - x.t0), Infinity) / 2;
  const now = Date.now();
  const X = Math.ceil((now + half + W + 40 + est.offset) / 1000) * 1000; // 다음 서버 정각 초
  const Bn = X - est.offset;                                         // 그 순간의 엣지 시각(추정)
  const rs = await Promise.all(Array.from({ length: N }, async (_, i) => {
    const wait = Bn - W + (2 * W * i) / (N - 1) - half - Date.now();
    if (wait > 0) await sleep(wait);
    return hit(url);
  }));
  for (const r of rs) if (!isNaN(r.s)) samples.push(r);
}

async function measure(url) {
  const first = await hit(url);
  // 520~530은 Cloudflare가 대신 만든 오류 응답(없는 도메인·연결 실패) — Date가 엣지 시각이라 대상 서버 시각이 아니다
  if (first.status >= 520 && first.status <= 530) return { error: "fetch-failed", status: first.status };
  if (isNaN(first.s)) return { error: "no-date-header", status: first.status };
  const samples = [first];
  // 1.3초 동안 시각이 한 번도 안 바뀌면 캐시된 응답 — 틀린 값을 내느니 측정 불가로 알린다
  if (!(await coarse(url, samples))) return { error: "stale-date", rtt: first.t1 - first.t0, samples: samples.length };
  let est = solve(samples);
  const coarseErr = est.err;
  // 정밀 단계는 최대 2번 — 1번 만에 ±25ms 안이면 멈춘다 (단계마다 다음 초 경계까지 ~1초 기다리므로)
  for (let i = 0; i < 2 && est.err > (i ? 25 : 12); i++) {
    try { await refine(url, samples, est); } catch { break; }
    const next = solve(samples);
    if (next.err >= est.err && i > 0) break;
    est = next;
  }
  const rtt = Math.min(...samples.map((x) => x.t1 - x.t0));
  return { offset: Math.round(est.offset), err: Math.max(5, Math.round(est.err)), coarseErr: Math.round(coarseErr), rtt, samples: samples.length, status: first.status };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname, searchParams } = new URL(request.url);

    if (pathname === "/now") return json({ now: Date.now() });

    if (pathname === "/server") {
      const target = parseTarget(searchParams.get("url"));
      if (!target) return json({ error: "bad-url" }, 400);
      const cache = caches.default;
      const key = new Request("https://cache.timerdesk/" + target.host);
      const hitCache = await cache.match(key);
      if (hitCache) {
        const c = await hitCache.json();
        return json({ ...c, cached: true, now: Date.now() });
      }
      let res;
      let final;
      try { final = await resolve(target.href); res = await measure(final); }
      catch (e) { return json({ error: "fetch-failed", host: target.host }, 502); }
      const body = { host: target.host, final: new URL(final).host + new URL(final).pathname, ...res };
      if (!res.error) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { "Cache-Control": `max-age=${CACHE_SEC}` } })));
      return json({ ...body, now: Date.now() });
    }

    return json({ service: "TimerDesk server time", endpoints: ["/now", "/server?url=example.com"] });
  },
};

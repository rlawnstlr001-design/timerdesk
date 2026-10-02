/* TimerDesk 서버시간 중계 (Cloudflare Worker)
   GET /now                 → { now }  : Cloudflare 엣지 시계(NTP 동기) — 기기 시계 오차 측정용
   GET /server?url=<주소>   → { host, offset, err, rtt, samples, now }
     offset = (대상 서버 시각) − (엣지 시각), ms. Date 헤더는 1초 단위라, 연속 요청으로
     '초가 바뀌는 순간'을 잡아 경계 시각을 추정한다. err = ± 추정 오차(ms).
   남용 방지: http(s)·공개 호스트만, 결과는 호스트별 20초 캐시(같은 사이트를 여러 명이 봐도 대상에 요청이 몰리지 않게). */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};
const MAX_REQ = 45;        // 한 번 측정에 대상 서버로 보내는 최대 요청 수 (무료 플랜 서브요청 50 미만)
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

async function measure(url) {
  const first = await hit(url);
  // 520~530은 Cloudflare가 대신 만든 오류 응답(없는 도메인·연결 실패) — Date가 엣지 시각이라 대상 서버 시각이 아니다
  if (first.status >= 520 && first.status <= 530) return { error: "fetch-failed", status: first.status };
  if (isNaN(first.s)) return { error: "no-date-header", status: first.status };
  const rtt = first.t1 - first.t0;
  let prev = first, n = 1;
  const deadline = first.t1 + 1300; // 1초 경계는 반드시 이 안에 온다
  // 초 경계를 넘을 때까지 ~30ms 간격으로 연속 요청 (응답이 빠른 사이트는 쉬어 가며 1초를 덮는다)
  while (n < MAX_REQ && Date.now() < deadline) {
    const wait = Math.max(0, GAP_MS - (prev.t1 - prev.t0));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const cur = await hit(url); n++;
    if (isNaN(cur.s)) break;
    if (cur.s > prev.s) {
      // 대상 서버의 '초 시작(cur.s ms)'은 prev.mid 와 cur.mid 사이 어딘가에서 일어났다
      const boundary = (prev.mid + cur.mid) / 2;
      return { offset: Math.round(cur.s - boundary), err: Math.round((cur.mid - prev.mid) / 2), rtt, samples: n, status: first.status };
    }
    prev = cur;
  }
  // 1.3초 동안 시각이 한 번도 안 바뀌면 캐시된 응답 — 틀린 값을 내느니 측정 불가로 알린다
  return { error: "stale-date", rtt, samples: n };
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

#!/usr/bin/env python3
"""정적 사이트 빌드: site.json + i18n/*.json + templates/ + tools/* -> dist/

실행: python build.py   (의존성 없음, 표준 라이브러리만)
"""
import datetime
import hashlib
import html
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
SITE = json.loads((ROOT / "site.json").read_text("utf-8"))
BASE = SITE["baseUrl"].rstrip("/")
LANGS = SITE["languages"]
DEFAULT = SITE["defaultLang"]
TOOLS = SITE["tools"]
L = {lg: json.loads((ROOT / "i18n" / f"{lg}.json").read_text("utf-8")) for lg in LANGS}
# 가이드 글: guides/<lang>/<slug>.json — {title, description, h1, lead, date, updated, tools[], sources[{name,url}], html}
GUIDES = {lg: sorted((dict(json.loads(f.read_text("utf-8")), slug=f.stem) for f in (ROOT / "guides" / lg).glob("*.json")),
                     key=lambda g: (g.get("order", 99), g["slug"])) if (ROOT / "guides" / lg).exists() else [] for lg in LANGS}
BASE_TPL = (ROOT / "templates" / "base.html").read_text("utf-8")
# 응원 한 줄: cheer/<lang>.json — 도구 아래에 새로고침마다 무작위로, 완료 순간엔 기록을 넣은 칭찬 (브라우저에서만 표시)
CHEER = {lg: json.loads((ROOT / "cheer" / f"{lg}.json").read_text("utf-8")) for lg in LANGS if (ROOT / "cheer" / f"{lg}.json").exists()}
CHEER_KIND = {"exam-timer": "exam", "exam-countdown": "exam", "pomodoro-timer": "focus", "study-stopwatch": "focus",
              "visual-timer": "focus", "dday-calculator": "day", "age-calculator": "day", "salary-calculator": "work",
              "holiday-pay-calculator": "work", "severance-calculator": "change", "unemployment-calculator": "change",
              "server-time": "ticket"}
TODAY = datetime.date.today().isoformat()
SITEMAP = []  # (path, {lang: path})


def esc(s):
    return html.escape(str(s), quote=True)


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s)


def lookup(ctx, path):
    cur = ctx
    for p in path.split("."):
        if isinstance(cur, dict) and p in cur:
            cur = cur[p]
        else:
            raise KeyError(path)
    return cur


def render(tpl, ctx, where):
    """{{a.b.c}} 치환. 키가 없으면 빌드를 멈춘다 (번역 누락 방지)."""
    def rep(m):
        try:
            return str(lookup(ctx, m.group(1)))
        except KeyError:
            raise SystemExit(f"[번역 누락] {m.group(1)} — {where}")
    return re.sub(r"\{\{\s*([\w.\-]+)\s*\}\}", rep, tpl)


def url(path):
    return BASE + path


def path_of(kind, lang, slug=None):
    if kind == "hub":
        return f"/{lang}/"
    if kind in ("privacy", "about", "contact", "guides"):
        return f"/{lang}/{kind}/"
    if kind == "guide":
        return f"/{lang}/guides/{slug}/"
    return f"/{lang}/{slug}/"


def alternates(kind, slug=None):
    alts = {lg: path_of(kind, lg, slug) for lg in LANGS if kind != "tool" or slug in L[lg]["tools"]}
    xdef = "/" if kind == "hub" else alts.get(DEFAULT, next(iter(alts.values())))
    return alts, xdef


def alt_tags(alts, xdef):
    tags = [f'<link rel="alternate" hreflang="{lg}" href="{url(p)}">' for lg, p in alts.items()]
    tags.append(f'<link rel="alternate" hreflang="x-default" href="{url(xdef)}">')
    return "\n".join(tags)


def asset_ver(p):
    return hashlib.md5(p.read_bytes()).hexdigest()[:8]


def ad_slot(name):
    client, slot = SITE.get("adsenseClient"), SITE.get("adsenseSlots", {}).get(name)
    if not client or not slot:
        return ""
    return (f'<div class="ad"><ins class="adsbygoogle" style="display:block" data-ad-client="{client}" '
            f'data-ad-slot="{slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>'
            '<script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>')


def head_extra():
    out = []
    # 검색엔진 소유 확인 (site.json: naverVerification·bingVerification — 값만 넣으면 전 페이지 head에 들어간다)
    for key, name in (("naverVerification", "naver-site-verification"), ("bingVerification", "msvalidate.01")):
        if SITE.get(key):
            out.append(f'<meta name="{name}" content="{esc(SITE[key])}">')
    # 광고·분석 서버 미리 연결 (Lighthouse 10/21: 약 0.4초 단축). crossorigin은 실제 요청 방식과 맞춰야 연결이 재사용된다
    if SITE.get("adsenseClient"):
        out.append('<link rel="preconnect" href="https://pagead2.googlesyndication.com" crossorigin>'
                   '<link rel="dns-prefetch" href="https://googleads.g.doubleclick.net">')
    if SITE.get("ga4"):
        out.append('<link rel="preconnect" href="https://www.googletagmanager.com">'
                   '<link rel="dns-prefetch" href="https://www.google-analytics.com">')
    if SITE.get("adsenseClient"):
        out.append(f'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={SITE["adsenseClient"]}" crossorigin="anonymous"></script>')
    if SITE.get("ga4"):
        g = SITE["ga4"]
        # EEA·영국·스위스는 동의 전 쿠키 거부(Consent Mode v2 — 쿠키 없는 집계만), 그 외 지역은 허용
        eea = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
               "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH"]
        # 실제 도메인에서만 수집 — localhost 미리보기·테스트가 통계를 오염시키지 않게.
        # 운영자 기기 제외: 주소에 ?noga=1을 한 번 붙여 열면 그 브라우저는 이후 수집 안 함(?noga=0 해제)
        hosts = json.dumps([SITE["domain"], "www." + SITE["domain"]])
        out.append("<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}"
                   "(function(){try{var q=new URLSearchParams(location.search).get('noga');"
                   "if(q==='1')localStorage.setItem('td-noga','1');if(q==='0')localStorage.removeItem('td-noga');"
                   "if(localStorage.getItem('td-noga'))return}catch(e){}"
                   f"if({hosts}.indexOf(location.hostname)<0)return;"
                   "var s=document.createElement('script');s.async=true;"
                   f"s.src='https://www.googletagmanager.com/gtag/js?id={g}';document.head.appendChild(s);"
                   "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',"
                   f"analytics_storage:'denied',region:{json.dumps(eea)},wait_for_update:500}});"
                   "gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'});"
                   # 탭 제목에 남은 시간·현재 시각이 들어가므로 page_title은 로드 시점 제목으로 고정
                   f"gtag('js',new Date());gtag('config','{g}',{{page_title:document.title}})}})();</script>")
    return "\n".join(out)


def json_ld(objs):
    return "\n".join(
        '<script type="application/ld+json">' + json.dumps(o, ensure_ascii=False).replace("</", "<\\/") + "</script>"
        for o in objs)


def nav_html(lang, current=None):
    """헤더 메뉴: 현재 도구와 같은 그룹(타이머/계산기)만 + 다른 그룹 허브 링크."""
    tools = L[lang]["tools"]
    group = tools[current].get("group", "timer") if current else "timer"
    links = []
    for slug in TOOLS:
        if slug not in tools or tools[slug].get("group", "timer") != group:
            continue
        cur = ' aria-current="page"' if slug == current else ""
        links.append(f'<a href="{path_of("tool", lang, slug)}"{cur}>{esc(tools[slug]["nav"])}</a>')
    for g, label in L[lang]["ui"]["groups"].items():
        if g != group and any(tools[s].get("group", "timer") == g for s in TOOLS if s in tools):
            links.append(f'<a class="nav-group" href="{path_of("hub", lang)}#{g}">{esc(label)} →</a>')
    if GUIDES.get(lang):
        links.append(f'<a class="nav-group" href="{path_of("guides", lang)}">{esc(L[lang]["ui"]["guides"])}</a>')
    return "".join(links)


def lang_switch(alts, lang):
    """언어 메뉴: 🌐 버튼을 누르면 펼쳐지는 목록 (링크는 HTML에 그대로 있어 크롤링됨)."""
    out = []
    for lg, p in alts.items():
        cur = ' aria-current="true"' if lg == lang else ""
        out.append(f'<a href="{p}" hreflang="{lg}" lang="{lg}"{cur}>{esc(L[lg]["name"])}</a>')
    return (f'<details class="lang-menu"><summary aria-label="{esc(L[lang]["ui"]["language"])}">🌐 {esc(L[lang]["name"])}</summary>'
            f'<div class="lang-list">{"".join(out)}</div></details>')


def cards_html(lang, exclude=None, group=None):
    out = []
    for slug in TOOLS:
        t = L[lang]["tools"].get(slug)
        if slug == exclude or not t or (group and t.get("group", "timer") != group):
            continue
        out.append(f'<a class="card" href="{path_of("tool", lang, slug)}"><span class="card-icon">{t["icon"]}</span>'
                   f'<strong>{esc(t["nav"])}</strong><span>{esc(t["card"])}</span></a>')
        if group:  # 홈 묶음에만: 하위 페이지 바로가기 카드 (hub.extraCards, after=도구 slug)
            for x in L[lang]["hub"].get("extraCards", []):
                if x["after"] == slug:
                    out.append(f'<a class="card" href="{x["href"]}"><span class="card-icon">{x["icon"]}</span>'
                               f'<strong>{esc(x["nav"])}</strong><span>{esc(x["card"])}</span></a>')
    return f'<div class="cards">{"".join(out)}</div>' if out else ""


def grouped_cards(lang):
    out = []
    for g, label in L[lang]["ui"]["groups"].items():
        cards = cards_html(lang, group=g)
        if cards:
            out.append(f'<section class="tool-group" id="{g}"><h2>{esc(label)}</h2>{cards}</section>')
    return "".join(out)


def write_page(path, lang, kind, title, description, body, alts, xdef, scripts="", ld=None, current=None):
    S = L[lang]
    ctx = {
        "site": SITE,
        "L": S,
        "year": datetime.date.today().year,
        "page": {
            "lang": lang, "kind": kind, "title": esc(title), "description": esc(description),
            "url": url(path), "alternates": alt_tags(alts, xdef), "home": path_of("hub", lang),
            "privacy": path_of("privacy", lang), "nav": nav_html(lang, current),
            "about": path_of("about", lang), "contact": path_of("contact", lang),
            "langSwitch": lang_switch(alts, lang), "body": body, "scripts": scripts,
            "head": head_extra() + ("\n" + json_ld(ld) if ld else ""),
            "manifest": path_of("hub", lang) + "manifest.webmanifest",
        },
        "v": VER,
    }
    out = DIST / path.lstrip("/") / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(BASE_TPL, ctx, path), "utf-8")
    SITEMAP.append((path, alts))


SRV_FACTS = json.loads((ROOT / "data" / "srv_facts.json").read_text("utf-8")) if (ROOT / "data" / "srv_facts.json").exists() else {}
SRV_META = json.loads((ROOT / "data" / "srv_meta.json").read_text("utf-8")) if (ROOT / "data" / "srv_meta.json").exists() else {}


def srv_facts_html(lang, t, v):
    """서버시간 하위 페이지 고유 정보: 실측 서버 시계 차이·접속 시 이동 화면·대표 홈페이지 (data/srv_facts.json·srv_meta.json).
    수치는 3회 측정 중앙값, 측정 2회 미만이거나 오차 100ms 초과면 수치를 싣지 않는다."""
    f, m, T = SRV_FACTS.get(v["site"]), SRV_META.get(v["slug"], {}), t["ui"].get("facts")
    if not f or not T or "error" in f:
        return ""
    name = v.get("target", v["label"])
    rows = [(T["host"], f'<code>{esc(v["site"])}</code>')]
    final = f.get("final", "").rstrip("/")
    if final and final != v["site"]:
        rows.append((T["lands"], f'<code>{esc(final)}</code>'))
    if m.get("access"):
        rows.append((T["access"], T["accessPortal"] if m["access"] == "포털" else T["accessOwn"]))
    if m.get("home"):
        rows.append((T["home"], f'<a href="{esc(m["home"])}" target="_blank" rel="noopener">{esc(m["home"].split("//")[1].rstrip("/"))}</a>'))
    good = f.get("n", 0) >= 2 and f.get("err", 999) <= 100
    if good:
        sec = abs(f["offset"]) / 1000
        word = T["ahead"] if f["offset"] > 0 else T["behind"]
        meas = T["measured"].replace("{d}", f["measured"]).replace("{n}", str(f["n"])).replace("{s}", f"{sec:.2f}").replace("{w}", word).replace("{e}", f'{f["err"] / 1000:.2f}')
    else:
        meas = T["noisy"].replace("{d}", f["measured"])
    rows.append((T["clock"], meas))
    table = "".join(f"<tr><th>{k}</th><td>{val}</td></tr>" for k, val in rows)
    note = T["note"].replace("{name}", esc(name))
    return f'<section><h2>{esc(T["h2"].replace("{name}", name))}</h2><div class="table-scroll"><table><tbody>{table}</tbody></table></div><p>{note}</p></section>'


def variant_links(lang, slug, current=None):
    """사이트별 하위 페이지(variants) 목록 — 본 페이지·하위 페이지 모두에 내부 링크로 단다."""
    t = L[lang]["tools"][slug]
    vs = t.get("variants", [])
    if not vs:
        return ""
    # variantGroups가 있으면 묶음별 섹션(예: 티켓 / 대학 수강신청), 지금 보는 페이지의 묶음을 먼저
    groups = t.get("variantGroups") or [{"key": None, "h2": t["variantsH2"]}]
    g0 = groups[0]["key"]  # group이 없는 변형은 첫 묶음 (정렬 전에 고정)
    gkey = lambda v: v.get("group", g0)
    cur = next((v for v in vs if v["slug"] == current), None)
    if cur:
        groups = sorted(groups, key=lambda g: g["key"] != gkey(cur))
    out = ""
    for g in groups:
        items = "".join(
            f'<a class="chip{" on" if v["slug"] == current else ""}" href="{path_of("tool", lang, slug)}{v["slug"]}/">{esc(v["label"])}</a>'
            for v in vs if g["key"] is None or gkey(v) == g["key"])
        out += f'<section><h2>{esc(g["h2"])}</h2><div class="presets variant-links">{items}</div></section>'
    return out


def cheer_cfg(lang, slug, v):
    C = CHEER.get(lang)
    kind = CHEER_KIND.get(slug)
    if v and v.get("group") == "univ":
        kind = "sugang"
    if v and slug == "exam-countdown" and v["slug"] == "takken":
        kind = "day"  # 시험은 끝나고 합격발표를 기다리는 페이지 — 공부 응원은 어울리지 않는다
    if not C or kind not in C["lines"]:
        return None
    return {"lines": C["lines"][kind], "done": C["done"], "fmt": C["fmt"]}


def build_tool(lang, slug, v=None):
    """도구 페이지. v(variant)가 있으면 /<lang>/<slug>/<v.slug>/ 하위 페이지 — 같은 도구에 사이트를 미리 고르고 문구만 다르게."""
    S, t = L[lang], L[lang]["tools"][slug]
    base = path_of("tool", lang, slug)
    path = base + v["slug"] + "/" if v else base
    P = v or t  # 제목·설명·본문 출처
    if v:
        alts, xdef = {lang: path}, path
    else:
        alts, xdef = alternates("tool", slug)
    frag = render((ROOT / "tools" / slug / "tool.html").read_text("utf-8"), {"ui": S["ui"], "t": t["ui"]}, f"{slug}/tool.html [{lang}]")
    cheer = cheer_cfg(lang, slug, v)
    if cheer:
        frag += '<p class="cheer" id="tdCheer" data-nosnippet hidden></p>'
    sections = "".join(f'<section><h2>{esc(x["h2"])}</h2>{x["html"]}</section>' for x in P["sections"])
    if v and slug == "server-time":
        sections += srv_facts_html(lang, t, v)
    sections += variant_links(lang, slug, v["slug"] if v else None)
    faq = "".join(f'<details><summary>{esc(f["q"])}</summary><div>{f["a"]}</div></details>' for f in P["faq"])
    # 본 페이지 리드 아래 바로가기 (도구 JSON links, href는 도구 경로 기준 상대)
    lead_links = "" if v or not t.get("links") else '<div class="presets variant-links lead-links">' + "".join(
        f'<a class="chip" href="{base}{x["href"]}">{esc(x["label"])}</a>' for x in t["links"]) + "</div>"
    crumbs = f'<a href="{path_of("hub", lang)}">{esc(S["ui"]["home"])}</a> <span>›</span> '
    crumbs += (f'<a href="{base}">{esc(t["nav"])}</a> <span>›</span> {esc(v["label"])}' if v else esc(t["nav"]))
    body = (
        f'<nav class="crumbs">{crumbs}</nav>'
        f'<h1>{esc(P["h1"])}</h1><p class="lead">{P["lead"]}</p>'
        f"{lead_links}"
        f"{frag}{ad_slot('afterTool')}"
        f'<article class="content">{sections}{ad_slot("inContent")}'
        f'<section class="faq"><h2>{esc(S["ui"]["faq"])}</h2>{faq}</section></article>'
        f'{guide_section(lang, slug)}'
        f'<section class="related"><h2>{esc(S["ui"]["relatedTools"])}</h2>{cards_html(lang, slug)}</section>'
    )
    i18n = {"lang": lang, "ui": S["ui"], "t": t["ui"]}
    if cheer:
        i18n["cheer"] = cheer
    extra = ""
    if slug == "exam-countdown" and v and v.get("exam"):
        extra += "window.TD_EXAM=" + json.dumps(v["exam"], ensure_ascii=False) + ";"
    if slug == "server-time":
        extra += f"window.TD_TIME_API={json.dumps(SITE.get('timeApi', ''))};"
        vs = t.get("variants", [])
        pages = {x["site"]: base + x["slug"] + "/" for x in vs if x["site"]}
        extra += f"window.TD_SRV_PAGES={json.dumps(pages)};"
        if v:
            extra += "window.TD_SRV_SITE=" + json.dumps({"url": v["site"], "label": v.get("target", v["label"])}, ensure_ascii=False) + ";"
            # 첫 묶음이 아닌 페이지(대학 수강신청 등)는 위쪽 사이트 버튼도 그 묶음 사이트로 바꾼다
            g0 = (t.get("variantGroups") or [{}])[0].get("key")
            if v.get("group", g0) != g0:
                chips = [{"label": x["label"], "url": x["site"]} for x in vs if x.get("group") == v["group"] and x["site"]]
                chips += [s for s in t["ui"]["sites"] if not s["url"]]  # 표준시
                extra += "window.TD_SRV_CHIPS=" + json.dumps(chips, ensure_ascii=False) + ";"
    scripts = (
        "<script>window.TD_I18N=" + json.dumps(i18n, ensure_ascii=False).replace("</", "<\\/") + ";" + extra + "</script>\n"
        f'<script src="/assets/common.js?v={VER["common"]}"></script>\n'
        + (f'<script src="/assets/tools/{slug}.data.js?v={VER[slug + ".data"]}"></script>\n' if slug + ".data" in VER else "")
        + f'<script src="/assets/tools/{slug}.js?v={VER[slug]}"></script>'
    )
    trail = [{"@type": "ListItem", "position": 1, "name": S["ui"]["home"], "item": url(path_of("hub", lang))},
             {"@type": "ListItem", "position": 2, "name": t["nav"], "item": url(base)}]
    if v:
        trail.append({"@type": "ListItem", "position": 3, "name": v["label"], "item": url(path)})
    ld = [
        {"@context": "https://schema.org", "@type": "WebApplication", "name": P["h1"], "url": url(path),
         "description": P["description"], "applicationCategory": "UtilitiesApplication", "operatingSystem": "Any",
         "inLanguage": lang, "isAccessibleForFree": True,
         "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}},
        {"@context": "https://schema.org", "@type": "FAQPage",
         "mainEntity": [{"@type": "Question", "name": f["q"],
                         "acceptedAnswer": {"@type": "Answer", "text": strip_tags(f["a"])}} for f in P["faq"]]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": trail},
    ]
    write_page(path, lang, "tool", P["title"], P["description"], body, alts, xdef, scripts, ld, slug)


def home_widget(lang):
    """첫 화면 시계 위젯 (home/widget.html + home/home.js). (body_html, scripts) 반환."""
    S = L[lang]
    html = render((ROOT / "home" / "widget.html").read_text("utf-8"), {"ui": S["ui"], "t": S["home"]}, f"home/widget.html [{lang}]")
    i18n = {"lang": lang, "ui": S["ui"], "t": S["home"]}
    scripts = ("<script>window.TD_I18N=" + json.dumps(i18n, ensure_ascii=False).replace("</", "<\\/") + ";</script>\n"
               f'<script src="/assets/common.js?v={VER["common"]}"></script>\n'
               f'<script src="/assets/home.js?v={VER["home"]}"></script>')
    return html, scripts


def build_hub(lang):
    S, h = L[lang], L[lang]["hub"]
    alts, xdef = alternates("hub")
    widget, scripts = home_widget(lang)
    body = (f'<section class="hero hero-home"><h1>{esc(h["h1"])}</h1>{widget}<p class="lead">{h["intro"]}</p></section>'
            f"{grouped_cards(lang)}{guide_section(lang)}"
            f'<article class="content"><section><h2>{esc(h["aboutH2"])}</h2>{h["aboutHtml"]}</section></article>')
    ld = [{"@context": "https://schema.org", "@type": "WebSite", "name": SITE["brand"], "url": url(path_of("hub", lang)),
           "inLanguage": lang}]
    write_page(path_of("hub", lang), lang, "hub", h["title"], h["description"], body, alts, xdef, scripts, ld=ld)


def build_privacy(lang):
    S, p = L[lang], L[lang]["privacy"]
    alts, xdef = alternates("privacy")
    contact = SITE.get("contactEmail")
    contact_html = f'<p>{esc(p["contact"])} <a href="mailto:{esc(contact)}">{esc(contact)}</a></p>' if contact else ""
    body = (f'<article class="content legal"><h1>{esc(p["h1"])}</h1>'
            f'<p class="muted">{esc(p["effective"])} 2026-10-01</p>{p["html"]}{contact_html}</article>')
    write_page(path_of("privacy", lang), lang, "privacy", p["title"], p["description"], body, alts, xdef)


def build_info(lang, kind):
    """소개(about)·문의(contact) 페이지 — i18n의 같은 이름 키(title·description·h1·html). html의 {email}은 문의 메일 링크로."""
    S, p = L[lang], L[lang][kind]
    alts, xdef = alternates(kind)
    email = SITE.get("contactEmail", "")
    mail = f'<a href="mailto:{esc(email)}">{esc(email)}</a>'
    body = (f'<article class="content legal"><h1>{esc(p["h1"])}</h1>{p["html"].replace("{email}", mail)}'
            f'<p><a class="btn ghost small" href="{path_of("hub", lang)}">{esc(S["ui"]["allTools"])}</a></p></article>')
    write_page(path_of(kind, lang), lang, kind, p["title"], p["description"], body, alts, xdef)


def guide_cards(lang, items):
    return '<div class="cards">' + "".join(
        f'<a class="card" href="{path_of("guide", lang, g["slug"])}"><span class="card-icon">{g.get("icon", "📘")}</span>'
        f'<strong>{esc(g["h1"])}</strong><span>{esc(g["description"][:70])}…</span></a>' for g in items) + "</div>"


def guide_section(lang, tool=None):
    """허브(전체)·도구 페이지(그 도구를 다루는 가이드만) 하단 가이드 카드."""
    items = [g for g in GUIDES.get(lang, []) if tool is None or tool in g.get("tools", [])]
    if not items:
        return ""
    h2 = L[lang]["ui"]["guides"] if tool is None else L[lang]["ui"]["relatedGuides"]
    return f'<section class="related" id="guides"><h2>{esc(h2)}</h2>{guide_cards(lang, items)}</section>'


def build_guide(lang, g):
    S = L[lang]; u = S["ui"]
    path = path_of("guide", lang, g["slug"])
    tools = [t for t in g.get("tools", []) if t in S["tools"]]
    tool_cards = "".join(
        f'<a class="card" href="{path_of("tool", lang, t)}"><span class="card-icon">{S["tools"][t]["icon"]}</span>'
        f'<strong>{esc(S["tools"][t]["nav"])}</strong><span>{esc(S["tools"][t]["card"])}</span></a>' for t in tools)
    sources = "".join(f'<li><a href="{esc(x["url"])}" target="_blank" rel="noopener">{esc(x["name"])}</a></li>' for x in g.get("sources", []))
    others = [x for x in GUIDES[lang] if x["slug"] != g["slug"]][:4]
    crumbs = (f'<a href="{path_of("hub", lang)}">{esc(u["home"])}</a> <span>›</span> '
              f'<a href="{path_of("guides", lang)}">{esc(u["guides"])}</a> <span>›</span> {esc(g["h1"])}')
    body = (f'<nav class="crumbs">{crumbs}</nav><article class="content guide">'
            f'<h1>{esc(g["h1"])}</h1><p class="muted">{esc(u["updated"])} {g.get("updated", g["date"])}</p>'
            f'<p class="lead">{g["lead"]}</p>{g["html"]}'
            + (f'<section><h2>{esc(u["useTools"])}</h2><div class="cards">{tool_cards}</div></section>' if tool_cards else "")
            + (f'<section><h2>{esc(u["sources"])}</h2><ul>{sources}</ul></section>' if sources else "")
            + "</article>"
            + (f'<section class="related"><h2>{esc(u["moreGuides"])}</h2>{guide_cards(lang, others)}</section>' if others else ""))
    ld = [{"@context": "https://schema.org", "@type": "Article", "headline": g["h1"], "description": g["description"],
           "inLanguage": lang, "datePublished": g["date"], "dateModified": g.get("updated", g["date"]),
           "author": {"@type": "Organization", "name": SITE["brand"], "url": url(path_of("about", lang))},
           "publisher": {"@type": "Organization", "name": SITE["brand"]}, "mainEntityOfPage": url(path)},
          {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
              {"@type": "ListItem", "position": 1, "name": u["home"], "item": url(path_of("hub", lang))},
              {"@type": "ListItem", "position": 2, "name": u["guides"], "item": url(path_of("guides", lang))},
              {"@type": "ListItem", "position": 3, "name": g["h1"], "item": url(path)}]}]
    write_page(path, lang, "guide", g["title"], g["description"], body, {lang: path}, path, ld=ld)


def build_guides_index(lang):
    S = L[lang]; u = S["ui"]
    path = path_of("guides", lang)
    body = (f'<nav class="crumbs"><a href="{path_of("hub", lang)}">{esc(u["home"])}</a> <span>›</span> {esc(u["guides"])}</nav>'
            f'<h1>{esc(u["guidesH1"])}</h1><p class="lead">{esc(u["guidesLead"])}</p>{guide_cards(lang, GUIDES[lang])}')
    write_page(path, lang, "guides", f'{u["guidesH1"]} – {SITE["brand"]}', u["guidesLead"], body, {lang: path}, path)


def build_root():
    """루트 '/' = x-default. 자동 리다이렉트는 하지 않고 언어 선택 + 기본 언어 허브를 보여준다."""
    S, h = L[DEFAULT], L[DEFAULT]["hub"]
    alts, xdef = alternates("hub")
    picks = "".join(f'<a class="lang-pick" href="{path_of("hub", lg)}" lang="{lg}">{esc(L[lg]["name"])}</a>' for lg in LANGS)
    suggest = {lg: {"name": L[lg]["name"], "msg": L[lg]["ui"]["viewInLang"], "href": path_of("hub", lg)} for lg in LANGS}
    widget, wscripts = home_widget(DEFAULT)
    body = (f'<div class="lang-suggest" id="langSuggest" hidden></div>'
            f'<section class="hero hero-home"><h1>{esc(h["h1"])}</h1>{widget}<p class="lead">{h["intro"]}</p>'
            f'<div class="lang-picks">{picks}</div></section>{grouped_cards(DEFAULT)}')
    scripts = wscripts + ("<script>(function(){var S=" + json.dumps(suggest, ensure_ascii=False) + ";"
               "var l=(navigator.language||'').slice(0,2).toLowerCase();"
               f"if(l!=='{DEFAULT}'&&S[l]){{var b=document.getElementById('langSuggest');"
               "b.innerHTML='<a href=\"'+S[l].href+'\">'+S[l].msg+' →</a>';b.hidden=false;}})();</script>")
    write_page("/", DEFAULT, "root", h["title"], h["description"], body, alts, xdef, scripts)


def build_misc():
    links = " · ".join(f'<a href="{path_of("hub", lg)}">{esc(L[lg]["name"])}</a>' for lg in LANGS)
    (DIST / "404.html").write_text(
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>404 · {esc(SITE["brand"])}</title><link rel="stylesheet" href="/assets/style.css?v={VER["css"]}"></head>'
        f'<body><main class="wrap notfound"><h1>404</h1><p>Page not found · 페이지를 찾을 수 없습니다</p><p>{links}</p></main></body></html>',
        "utf-8")
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {url('/sitemap.xml')}\n", "utf-8")
    rows = []
    for path, alts in SITEMAP:
        alt = "".join(f'<xhtml:link rel="alternate" hreflang="{lg}" href="{url(p)}"/>' for lg, p in alts.items())
        rows.append(f"<url><loc>{url(path)}</loc><lastmod>{TODAY}</lastmod>{alt}</url>")
    (DIST / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + "\n".join(rows) + "\n</urlset>\n", "utf-8")
    if SITE.get("domain"):
        (DIST / "CNAME").write_text(SITE["domain"] + "\n", "utf-8")
    if SITE.get("adsenseClient"):  # 애드센스 판매자 인증 (ca-pub-… → pub-…)
        pub = SITE["adsenseClient"].replace("ca-", "")
        (DIST / "ads.txt").write_text(f"google.com, {pub}, DIRECT, f08c47fec0942fa0\n", "utf-8")
    (DIST / ".nojekyll").write_text("", "utf-8")
    for f in (ROOT / "root").glob("*"):  # 루트에 그대로 두는 파일 (검색엔진 소유 확인 파일 등)
        if f.is_file():
            shutil.copy(f, DIST / f.name)
    build_pwa()


def build_pwa():
    """홈 화면 앱(PWA): 언어별 manifest + 아이콘 + 서비스 워커(/sw.js).
    sw: 페이지는 네트워크 우선(오프라인이면 저장본), /assets·/icons는 캐시 우선(주소에 ?v= 버전이 붙어 갱신됨).
    다른 도메인(서버시간 Worker·GA·애드센스)은 건드리지 않는다."""
    icons_dir = DIST / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    for f in ["icon-192.png", "icon-512.png", "maskable-512.png"]:
        shutil.copy(ROOT / "assets" / "icons" / f, icons_dir / f)
    shutil.copy(ROOT / "assets" / "icons" / "apple-touch-icon.png", DIST / "apple-touch-icon.png")
    icons = [{"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
             {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
             {"src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]
    for lg in LANGS:
        man = {"name": f'{SITE["brand"]} – {L[lg]["ui"]["appName"]}', "short_name": SITE["brand"],
               "description": L[lg]["hub"]["description"], "lang": lg, "start_url": path_of("hub", lg), "scope": "/",
               "display": "standalone", "background_color": "#f6f7f6", "theme_color": "#0f766e", "icons": icons}
        (DIST / lg).mkdir(parents=True, exist_ok=True)
        (DIST / lg / "manifest.webmanifest").write_text(json.dumps(man, ensure_ascii=False, indent=1), "utf-8")
    ver = hashlib.md5(json.dumps(VER, sort_keys=True).encode()).hexdigest()[:10]
    (DIST / "sw.js").write_text((ROOT / "assets" / "sw.js").read_text("utf-8").replace("__VERSION__", ver), "utf-8")


if __name__ == "__main__":
    # 폴더째 지우면 로컬 서버·OneDrive가 잡고 있을 때 실패하므로 파일만 비운다
    if DIST.exists():
        for f in sorted(DIST.rglob("*"), reverse=True):
            if f.is_file():
                f.unlink()
            else:
                try:
                    f.rmdir()
                except OSError:
                    pass
    (DIST / "assets" / "tools").mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / "assets" / "style.css", DIST / "assets" / "style.css")
    shutil.copy(ROOT / "assets" / "common.js", DIST / "assets" / "common.js")
    shutil.copy(ROOT / "assets" / "favicon.svg", DIST / "favicon.svg")
    shutil.copy(ROOT / "assets" / "og.png", DIST / "og.png")  # 링크 카드·공유 미리보기
    VER = {"css": asset_ver(ROOT / "assets" / "style.css"), "common": asset_ver(ROOT / "assets" / "common.js"),
           "home": asset_ver(ROOT / "home" / "home.js")}
    shutil.copy(ROOT / "home" / "home.js", DIST / "assets" / "home.js")
    for slug in TOOLS:
        src = ROOT / "tools" / slug / "tool.js"
        shutil.copy(src, DIST / "assets" / "tools" / f"{slug}.js")
        VER[slug] = asset_ver(src)
        data = ROOT / "tools" / slug / "data.js"  # 선택: 도구가 쓰는 큰 데이터 (예: 간이세액표)
        if data.exists():
            shutil.copy(data, DIST / "assets" / "tools" / f"{slug}.data.js")
            VER[slug + ".data"] = asset_ver(data)
    for lg in LANGS:
        build_hub(lg)
        build_privacy(lg)
        build_info(lg, "about")
        build_info(lg, "contact")
        if GUIDES.get(lg):
            build_guides_index(lg)
            for g in GUIDES[lg]:
                build_guide(lg, g)
        for slug in TOOLS:
            if slug in L[lg]["tools"]:
                build_tool(lg, slug)
                for v in L[lg]["tools"][slug].get("variants", []):
                    build_tool(lg, slug, v)
    build_root()
    build_misc()
    print(f"빌드 완료: {len(SITEMAP)}페이지 -> {DIST}")

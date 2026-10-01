# TimerDesk (가칭) — 글로벌 무료 타이머 사이트

정적 사이트. 빌드 도구·프레임워크 없이 Python 표준 라이브러리 스크립트 하나로 다국어 페이지를 만든다.
전략·판정 기준은 볼트 `SoloOS-Vault/10-채널/툴사이트-timerdesk.md`.

## 실행

```bash
python build.py                                        # dist/ 생성
python -m http.server 8140 --directory dist            # http://localhost:8140
```

`.claude/launch.json`의 `tool-site` 설정이 같은 서버를 띄운다. 경로가 `/assets/...` 절대경로라 **dist를 루트로 서빙**해야 한다
(GitHub Pages는 커스텀 도메인을 붙이면 루트가 됨).

## 구조

```
site.json            브랜드·도메인·언어·도구 목록·애드센스/GA4 ID
i18n/<lang>.json     공통 UI 문구 + 허브·개인정보 + 도구별 제목/설명/본문/FAQ/런타임 문구
templates/base.html  공통 레이아웃 ({{a.b}} 치환)
tools/<slug>/        tool.html(도구 마크업, {{ui.*}} {{t.*}}) + tool.js
assets/              style.css, common.js(window.TD: 소리·전체화면·화면꺼짐방지·카운트다운), favicon.svg
build.py             -> dist/ (페이지, sitemap.xml, robots.txt, 404, CNAME)
```

- 도구 스크립트 로드 순서: `TD_I18N`(인라인) → `common.js` → `tools/<slug>.js`. 공유는 `window.TD`로만.
- 번역 키가 빠지면 빌드가 `[번역 누락]`으로 멈춘다.

## 늘리는 법

- **도구 추가**: `tools/<slug>/tool.html`·`tool.js` 만들고 → `site.json`의 `tools`에 slug 추가 → 각 `i18n/*.json`의 `tools`에 항목 추가.
- **언어 추가**: `i18n/ko.json`을 복사해 `i18n/ja.json` 번역 → `site.json`의 `languages`에 추가. 끝.
- **광고**: 애드센스 승인 후 `adsenseClient`(ca-pub-…)와 `adsenseSlots` ID를 넣고 재빌드.
- **도메인**: `baseUrl`·`domain`에 구매한 도메인 → 재빌드하면 `CNAME` 생성.

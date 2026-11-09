# -*- coding: utf-8 -*-
"""배포 뒤 내용이 바뀐 페이지만 IndexNow(Bing 등)에 알린다 — data/page_dates.json의 직전 커밋과 비교.
키 파일은 root/<키>.txt (공개가 정상). 실패해도 배포에는 영향 없음."""
import json
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = json.loads((ROOT / "site.json").read_text("utf-8"))
KEY = next(p.stem for p in (ROOT / "root").glob("*.txt") if len(p.stem) == 32 and p.read_text("utf-8").strip() == p.stem)


def main():
    now = json.loads((ROOT / "data" / "page_dates.json").read_text("utf-8"))
    r = subprocess.run(["git", "show", "HEAD~1:data/page_dates.json"], cwd=ROOT, capture_output=True)
    old = json.loads(r.stdout.decode("utf-8")) if r.returncode == 0 else {}
    urls = [f"https://{SITE['domain']}{p}" for p, v in now.items() if old.get(p, {}).get("hash") != v["hash"]]
    if not urls:
        print("[indexnow] 바뀐 페이지 없음")
        return
    body = json.dumps({"host": SITE["domain"], "key": KEY, "keyLocation": f"https://{SITE['domain']}/{KEY}.txt", "urlList": urls[:10000]}).encode()
    req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=30) as res:
        print(f"[indexnow] {len(urls)}개 전송 → HTTP {res.status}")


if __name__ == "__main__":
    main()

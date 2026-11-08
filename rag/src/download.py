"""Stage 0a: discover and download every O-1 AAO non-precedent decision PDF.

The AAO search page filters the "I-129 (Extraordinary Ability - O)" category with
uri_1=4. It paginates 100 rows per page via `page=N`. The case ID is the PDF filename.
"""

from __future__ import annotations

import json
import random
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urljoin

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
MANIFEST = ROOT / "data" / "manifest.json"

BASE = "https://www.uscis.gov"
SEARCH = BASE + "/administrative-appeals/aao-decisions/aao-non-precedent-decisions"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
PDF_RE = re.compile(r'href="([^"]+\.pdf)"', re.I)

session = requests.Session()
session.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})


def polite_get(url: str, params: dict | None = None, retries: int = 5) -> requests.Response:
    for attempt in range(retries):
        try:
            r = session.get(url, params=params, timeout=60)
            if r.status_code == 200:
                return r
            print(f"  HTTP {r.status_code} for {url} (attempt {attempt + 1})", file=sys.stderr)
        except requests.RequestException as e:
            print(f"  {e} (attempt {attempt + 1})", file=sys.stderr)
        time.sleep(2 ** attempt + random.random())
    raise RuntimeError(f"giving up on {url}")


def discover() -> list[str]:
    urls: list[str] = []
    page = 0
    while True:
        r = polite_get(SEARCH, {"uri_1": 4, "m": "All", "y": "All", "items_per_page": 100, "page": page})
        found = [urljoin(BASE, h) for h in PDF_RE.findall(r.text)]
        new = [u for u in found if u not in urls]
        print(f"page {page}: {len(found)} links, {len(new)} new")
        if not new:
            break
        urls.extend(new)
        page += 1
        time.sleep(1 + random.random())
    return urls


def case_id(url: str) -> str:
    return Path(unquote(url)).stem


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    urls = discover()
    manifest = {case_id(u): u for u in urls}
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f"{len(manifest)} decisions listed")

    for i, (cid, url) in enumerate(manifest.items(), 1):
        dest = RAW / f"{cid}.pdf"
        if dest.exists() and dest.stat().st_size > 0:
            continue
        r = polite_get(url)
        if not r.content.startswith(b"%PDF"):
            print(f"  {cid}: not a PDF, skipped", file=sys.stderr)
            continue
        dest.write_bytes(r.content)
        print(f"[{i}/{len(manifest)}] {cid}")
        time.sleep(1 + random.random())


if __name__ == "__main__":
    main()

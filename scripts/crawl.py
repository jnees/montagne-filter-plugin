"""Records Montagne Parfums stock changes over time.

Fetches the public /fragrance page (all products are on one page), compares it
with the last snapshot, and writes:

  data/products.json  current state of every product ever seen
  data/events.csv     one row per change: new, sold_out, restocked,
                      price_change, removed, returned

Files are only rewritten when something changed, so the scheduled workflow
commits only real changes. Uses only the Python standard library.

Usage:
  python3 scripts/crawl.py                  check once
  python3 scripts/crawl.py --html page.html check a saved page (for testing)
  python3 scripts/crawl.py --watch          follow the Friday drop: wait for the
                                            window (New York time), then check
                                            every minute, then every few minutes
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

URL = "https://www.montagneparfums.com/fragrance"
USER_AGENT = (
    "MontyFiltersBot/1.0 (+https://github.com/jnees/montagne-filter-plugin; "
    "checks stock hourly, and every minute or so during the Friday restock)"
)
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PRODUCTS = DATA / "products.json"
EVENTS = DATA / "events.csv"
EVENT_FIELDS = ["time", "event", "id", "name", "detail"]

# If the page yields far fewer products than this, assume the site is down or
# changed layout, and stop instead of recording everything as removed.
MIN_PRODUCTS = 50


class ProductListParser(HTMLParser):
    """Pulls id, url, title, price and sold-out flag from each product card."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.products: list[dict] = []
        self.current: dict | None = None
        self.div_depth = 0  # open <div>s inside the current card
        self.capture: str | None = None  # "name" or "price"
        self.capture_depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = (a.get("class") or "").split()

        if self.current is None:
            if tag == "div" and "ProductList-item" in classes and a.get("data-item-id"):
                self.current = {
                    "id": a["data-item-id"],
                    "soldOut": "sold-out" in classes,
                    "url": "",
                    "name": "",
                    "_price": "",
                }
                self.div_depth = 1
            return

        if tag == "div":
            self.div_depth += 1
        if tag == "a" and "ProductList-item-link" in classes:
            self.current["url"] = a.get("href", "")
        elif tag == "h1" and "ProductList-title" in classes:
            self.capture = "name"
        elif tag == "div" and "product-price" in classes:
            self.capture, self.capture_depth = "price", self.div_depth

    def handle_endtag(self, tag):
        if self.current is None:
            return
        if tag == "h1" and self.capture == "name":
            self.capture = None
        if tag == "div":
            if self.capture == "price" and self.div_depth == self.capture_depth:
                self.capture = None
            self.div_depth -= 1
            if self.div_depth == 0:
                self.products.append(finish(self.current))
                self.current = None

    def handle_data(self, data):
        if self.current is not None and self.capture == "name":
            self.current["name"] += data
        elif self.current is not None and self.capture == "price":
            self.current["_price"] += data


def finish(p: dict) -> dict:
    # Sale items list both prices; keep the lower (what you'd pay).
    prices = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*\.?\d*", p.pop("_price"))]
    p["price"] = min(prices) if prices else None
    p["name"] = " ".join(p["name"].split())
    if p["url"].startswith("/"):
        p["url"] = "https://www.montagneparfums.com" + p["url"]
    return p


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def update(previous: dict, scraped: list[dict], at: str) -> tuple[dict, list[dict]]:
    """Merges a scrape into the stored products and returns the new events."""
    products = {k: dict(v) for k, v in previous.items()}
    events: list[dict] = []
    first_run = not previous

    def event(kind: str, p: dict, detail: str = "") -> None:
        events.append({"time": at, "event": kind, "id": p["id"], "name": p["name"], "detail": detail})

    seen = set()
    for p in scraped:
        seen.add(p["id"])
        old = products.get(p["id"])
        if old is None:
            products[p["id"]] = {
                "name": p["name"],
                "url": p["url"],
                "price": p["price"],
                "soldOut": p["soldOut"],
                "firstSeen": at,
                "lastChange": at,
                "removed": False,
            }
            if not first_run:
                event("new", p, "sold out" if p["soldOut"] else "in stock")
            continue

        changed = False
        if old.get("removed"):
            event("returned", p)
            old["removed"] = False
            changed = True
        if old["soldOut"] != p["soldOut"]:
            event("sold_out" if p["soldOut"] else "restocked", p)
            old["soldOut"] = p["soldOut"]
            changed = True
        if old["price"] != p["price"]:
            event("price_change", p, f"{old['price']} -> {p['price']}")
            old["price"] = p["price"]
            changed = True
        if changed:
            old["lastChange"] = at
        # Names and URLs can be edited by the store; keep them current quietly.
        old["name"], old["url"] = p["name"], p["url"]

    for pid, old in products.items():
        if pid not in seen and not old.get("removed"):
            old["removed"] = True
            old["lastChange"] = at
            event("removed", {"id": pid, "name": old["name"]})

    return products, events


def check(html: str) -> bool:
    """Parses one copy of the page and saves any changes. False if unusable."""
    p = ProductListParser()
    p.feed(html)
    scraped = p.products
    if len(scraped) < MIN_PRODUCTS:
        print(f"Only found {len(scraped)} products; not updating data.", file=sys.stderr)
        return False

    previous = json.loads(PRODUCTS.read_text()) if PRODUCTS.exists() else {}
    at = now_iso()
    products, events = update(previous, scraped, at)

    in_stock = sum(1 for x in scraped if not x["soldOut"])
    print(f"{at}  {len(scraped)} products, {in_stock} in stock, {len(events)} changes")
    for e in events:
        print(f"  {e['event']:<12} {e['name']}  {e['detail']}")

    if products == previous:
        return True

    DATA.mkdir(exist_ok=True)
    PRODUCTS.write_text(json.dumps(dict(sorted(products.items())), indent=2) + "\n")
    new_file = not EVENTS.exists()
    with EVENTS.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=EVENT_FIELDS)
        if new_file:
            writer.writeheader()
        writer.writerows(events)
    return True


def watch(args: argparse.Namespace) -> int:
    """Waits for the restock window, then checks frequently until it closes.

    The workflow starts this twice on Fridays (an hour apart in UTC) because
    GitHub's schedule ignores daylight saving; whichever run lands within
    --max-lead minutes before the window does the watching, the other exits.
    """
    tz = ZoneInfo(args.tz)
    now = datetime.now(tz)

    def today_at(hhmm: str) -> datetime:
        h, m = map(int, hhmm.split(":"))
        return now.replace(hour=h, minute=m, second=0, microsecond=0)

    start, fast_until, end = today_at(args.start), today_at(args.fast_until), today_at(args.end)
    lead_min = (start - now).total_seconds() / 60
    if now >= end:
        print(f"Window ({args.start}-{args.end} {args.tz}) is over for today; nothing to do.")
        return 0
    if lead_min > args.max_lead:
        print(f"Window starts in {lead_min:.0f} min; leaving it to a later run.")
        return 0
    if lead_min > 0:
        print(f"Waiting {lead_min:.0f} min for the window ({args.start} {args.tz}).", flush=True)
        time.sleep(lead_min * 60)

    while True:
        t = datetime.now(tz)
        try:
            check(fetch(URL))
        except Exception as e:  # keep watching through a failed request
            print(f"{now_iso()}  check failed: {e}", file=sys.stderr)
        sys.stdout.flush()
        interval = args.fast_interval if t < fast_until else args.slow_interval
        next_at = t + timedelta(seconds=interval)
        if next_at >= end:
            return 0
        time.sleep(max(0, (next_at - datetime.now(tz)).total_seconds()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--html", help="parse a saved page instead of fetching")
    parser.add_argument("--watch", action="store_true", help="follow the restock window")
    parser.add_argument("--tz", default="America/New_York", help="time zone for the window")
    parser.add_argument("--start", default="16:55", help="window start, HH:MM (default 16:55)")
    parser.add_argument("--fast-until", default="17:10", help="check every --fast-interval until HH:MM")
    parser.add_argument("--end", default="17:50", help="window end, HH:MM (default 17:50)")
    parser.add_argument("--fast-interval", type=int, default=60, help="seconds (default 60)")
    parser.add_argument("--slow-interval", type=int, default=180, help="seconds (default 180)")
    parser.add_argument("--max-lead", type=int, default=75,
                        help="exit if the window starts more than this many minutes away")
    args = parser.parse_args()

    if args.watch:
        return watch(args)
    html = Path(args.html).read_text() if args.html else fetch(URL)
    return 0 if check(html) else 1


if __name__ == "__main__":
    sys.exit(main())

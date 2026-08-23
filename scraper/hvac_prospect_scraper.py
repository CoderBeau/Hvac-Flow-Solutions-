#!/usr/bin/env python3
"""
HVAC Flow Solutions — Contractor Prospect Scraper (standalone)

Finds HVAC contractors who are VISIBLY PAYING for shared leads
(Thumbtack, Angi, Yelp ads) in your target metros, enriches them with
owner names and direct contact info (BBB profiles + the shops' own
websites), scores them Hot/Warm/Cool, and writes everything to a local
CSV + JSON you can open in Excel or Google Sheets.

That target list is the point: a contractor already paying Thumbtack or
Angi has proven they spend money on leads — and every shared-lead
platform gives them the same reasons to switch to an exclusive-lead
offer (shared leads, ghost leads billed anyway, contract traps).

This tool ONLY collects and scores. It sends nothing, uploads nothing,
and touches nothing outside the output folder on this computer.

One-time setup:
    pip install playwright
    playwright install chromium

Usage:
    python hvac_prospect_scraper.py                          # San Antonio, all sources
    python hvac_prospect_scraper.py --metro "Austin, TX"     # different metro (repeatable)
    python hvac_prospect_scraper.py --sources thumbtack,bbb  # subset of sources
    python hvac_prospect_scraper.py --limit 10               # max profiles per source
    python hvac_prospect_scraper.py --headed                 # show the browser window
    python hvac_prospect_scraper.py --demo                   # fictional sample data (no scraping)

Ground rules:
  * Public pages only — nothing behind a login, no captcha busting.
    If a site shows a block/human-check page, that source is skipped
    (run with --headed and pass the check yourself, or collect those
    few by hand).
  * Polite pace — one page at a time, multi-second randomized delays,
    modest limits. You need 20 good prospects, not 2,000.
"""

import argparse
import csv
import json
import random
import re
import sys
import time
from datetime import date
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

# ── Constants ────────────────────────────────────────────────

# Domains that are never a contractor's own website.
PLATFORM_DOMAINS = [
    "thumbtack.com", "angi.com", "angieslist.com", "homeadvisor.com",
    "networx.com", "modernize.com", "yelp.com", "bbb.org",
    "google.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
    "linkedin.com", "youtube.com", "nextdoor.com", "pinterest.com",
    "apple.com", "mapbox.com", "gstatic.com", "schema.org",
]

# Badge/placement strings that mean the shop is SPENDING right now.
PAID_SIGNALS = [
    "top pro",             # Thumbtack
    "angi certified",      # Angi
    "super service award",
    "angi approved",
    "screened & approved",
    "elite service",       # HomeAdvisor
    "google guaranteed",
    "sponsored",
    "featured",
    "accredited",          # BBB — paying member
]

# Shared-lead platforms count toward the multi-platform Hot signal.
# BBB is an enrichment source (owner names), not a lead vendor.
LEAD_PLATFORMS = ["Thumbtack", "Angi", "HomeAdvisor", "Networx", "Modernize", "Yelp Ads"]

BLOCK_MARKERS = [
    "access denied", "unusual traffic", "are you a human", "verify you are human",
    "just a moment", "attention required", "px-captcha", "perimeterx",
    "request blocked", "pardon our interruption",
]

BUSINESS_LD_TYPES = {
    "LocalBusiness", "HVACBusiness", "HomeAndConstructionBusiness",
    "ProfessionalService", "Organization", "Plumber", "GeneralContractor",
}

PHONE_RE = re.compile(r"(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
EMAIL_JUNK = re.compile(r"(example\.|sentry|wixpress|\.png$|\.jpe?g$|\.gif$|\.svg$|\.webp$|noreply|no-reply|godaddy|schema\.org)", re.I)

CSV_FIELDS = ["business", "first_name", "last_name", "city", "zip", "phone", "email",
              "website", "platforms", "pain_signal", "tier", "score", "source", "notes"]

USER_AGENT = "Mozilla/5.0 (compatible; HFS-prospector/1.0)"


# ── Small extraction helpers ─────────────────────────────────

def is_platform_url(url):
    try:
        host = urlparse(url).hostname or ""
        host = host.removeprefix("www.")
        return any(host == d or host.endswith("." + d) for d in PLATFORM_DOMAINS)
    except ValueError:
        return True


def normalize_phone(raw):
    d = re.sub(r"\D", "", str(raw or ""))
    if len(d) == 10:
        return d
    if len(d) == 11 and d.startswith("1"):
        return d[1:]
    return ""


def format_phone(d):
    return f"({d[0:3]}) {d[3:6]}-{d[6:]}" if d and len(d) == 10 else (d or "")


def phones_from_text(text):
    return list(dict.fromkeys(a + b + c for a, b, c in PHONE_RE.findall(str(text or ""))))


def emails_from_html(html):
    found = []
    for m in EMAIL_RE.findall(str(html or "")):
        email = m.lower()
        if not EMAIL_JUNK.search(email) and email not in found:
            found.append(email)
    return found


def owner_from_text(text):
    """'Joe Ramos, Owner' / 'Principal Contacts: Mr. Joe Ramos' — the
    patterns BBB profiles and small-shop about pages actually use."""
    t = str(text or "")
    m = re.search(r"([A-Z][a-z]+)\s+(?:[A-Z]\.?\s+)?([A-Z][a-z]+)\s*,\s*(?:Owner|President|Principal|Founder|Managing Member|CEO)", t)
    if m:
        return m.group(1), m.group(2)
    m = re.search(r"Principal Contacts?[^A-Z]{0,40}(?:Mr\.?|Ms\.?|Mrs\.?)?\s*([A-Z][a-z]+)\s+(?:[A-Z]\.?\s+)?([A-Z][a-z]+)", t)
    if m:
        return m.group(1), m.group(2)
    return None


def detect_paid_signals(text):
    t = str(text or "").lower()
    return [s for s in PAID_SIGNALS if s in t]


def looks_blocked(text, title):
    t = (str(title or "") + " " + str(text or "")[:600]).lower()
    return any(m in t for m in BLOCK_MARKERS)


# ── Page-level extraction (Playwright) ───────────────────────

def jsonld_business(page):
    """First schema.org business object on the page (redesign-proof:
    directories keep JSON-LD stable long after their CSS changes)."""
    try:
        raws = page.eval_on_selector_all(
            'script[type="application/ld+json"]', "els => els.map(e => e.textContent)")
    except Exception:
        return None
    objects = []
    for raw in raws:
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        for obj in parsed if isinstance(parsed, list) else [parsed]:
            if not isinstance(obj, dict):
                continue
            graph = obj.get("@graph")
            if isinstance(graph, list):
                objects.extend(g for g in graph if isinstance(g, dict))
            else:
                objects.append(obj)
    for obj in objects:
        types = obj.get("@type") or []
        types = types if isinstance(types, list) else [types]
        if not BUSINESS_LD_TYPES.intersection(types):
            continue
        addr = obj.get("address") or {}
        if not isinstance(addr, dict):
            addr = {}
        url = obj.get("url") or ""
        return {
            "business": (obj.get("name") or "").strip() if isinstance(obj.get("name"), str) else "",
            "phone": normalize_phone(obj.get("telephone") or ""),
            "website": "" if not url or is_platform_url(url) else str(url).strip(),
            "city": (addr.get("addressLocality") or "").strip(),
            "zip": (addr.get("postalCode") or "").strip(),
            "email": (obj.get("email") or "").strip().lower() if isinstance(obj.get("email"), str) else "",
        }
    return None


def page_text(page):
    try:
        return page.evaluate("document.body ? document.body.innerText : ''")
    except Exception:
        return ""


def page_hrefs(page):
    try:
        hrefs = page.eval_on_selector_all("a[href]", "as => as.map(a => a.href)")
    except Exception:
        return []
    return list(dict.fromkeys(h.split("#")[0] for h in hrefs))


def polite_goto(page, url, delay_ms):
    time.sleep((delay_ms + random.uniform(0, delay_ms * 0.5)) / 1000)
    page.goto(url, wait_until="domcontentloaded", timeout=45000)
    time.sleep(1.5)


def lazy_scroll(page, rounds=3):
    for _ in range(rounds):
        try:
            page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
        except Exception:
            pass
        time.sleep(1.2)


# ── The shared harvest loop ──────────────────────────────────

def harvest_profiles(context, platform, search_url, link_filter, metro, limit, delay, log, extract_extra=None):
    """Open a public listing page, collect profile links, visit each,
    extract what's visible. All politeness/block handling lives here."""
    page = context.new_page()
    results = []
    try:
        log(f"  {platform}: opening {search_url}")
        polite_goto(page, search_url, delay)

        text = page_text(page)
        if looks_blocked(text, page.title()):
            log(f"  {platform}: the site is showing a block/human-check page. "
                "Re-run with --headed and pass the check yourself, or collect these by hand. Skipping source.")
            return results

        lazy_scroll(page)
        links = [h for h in page_hrefs(page) if link_filter(h)][:limit]
        log(f"  {platform}: found {len(links)} profile link(s), visiting up to {limit}...")

        for link in links:
            try:
                polite_goto(page, link, delay)
                text = page_text(page)
                if looks_blocked(text, page.title()):
                    log(f"  {platform}: blocked mid-run — keeping the {len(results)} collected so far.")
                    break

                ld = jsonld_business(page) or {}
                phones = phones_from_text(text)
                owner = owner_from_text(text)
                review_m = re.search(r"([\d,]+)\s+(?:reviews?|ratings?)", text, re.I)

                prospect = {
                    "business": ld.get("business") or re.split(r"[|\-–•]", page.title())[0].strip(),
                    "first_name": owner[0] if owner else "",
                    "last_name": owner[1] if owner else "",
                    "city": ld.get("city") or metro["city"],
                    "zip": ld.get("zip") or "",
                    "phone": format_phone(ld.get("phone") or (phones[0] if phones else "")),
                    "email": ld.get("email") or "",
                    "website": ld.get("website") or "",
                    "platform": platform,
                    "signals": detect_paid_signals(text),
                    "review_count": int(review_m.group(1).replace(",", "")) if review_m else 0,
                    "profile_url": link,
                }
                if extract_extra:
                    extract_extra(page, prospect, text)

                if len(prospect["business"]) > 2:
                    results.append(prospect)
                    tag = f"  [{', '.join(prospect['signals'])}]" if prospect["signals"] else ""
                    log(f"    + {prospect['business']}{tag}")
            except Exception as err:
                log(f"    (profile failed: {str(err).splitlines()[0]})")
    except Exception as err:
        log(f"  {platform}: source failed — {str(err).splitlines()[0]}")
    finally:
        try:
            page.close()
        except Exception:
            pass
    return results


# ── Sources ──────────────────────────────────────────────────
# Each source: where paying contractors are visible, and what a
# profile link looks like. BBB's extra fields feed the "owner-operated"
# signal (sole proprietors feel every wasted lead dollar personally).

def bbb_extra(page, prospect, text):
    if re.search(r"sole proprietor", text, re.I):
        prospect["signals"].append("owner-operated (sole proprietor)")
    m = re.search(r"years? in business:?\s*(\d+)", text, re.I)
    if m:
        prospect["years_in_business"] = int(m.group(1))


def make_sources():
    return {
        "thumbtack": {
            "platform": "Thumbtack",
            "url": lambda m: f"https://www.thumbtack.com/{m['state_slug']}/{m['city_slug']}/hvac-companies/",
            "link": lambda h: "thumbtack.com" in h and re.search(r"/service/\d+", h) is not None,
            "extra": None,
        },
        "angi": {
            "platform": "Angi",
            "url": lambda m: f"https://www.angi.com/companylist/us/{m['state_slug']}/{m['city_slug']}/hvac.htm",
            "link": lambda h: "angi.com" in h and re.search(r"-reviews-\d+\.htm", h) is not None,
            "extra": None,
        },
        "yelp": {
            "platform": "Yelp Ads",
            "url": lambda m: f"https://www.yelp.com/search?find_desc=HVAC&find_loc={quote(m['city'] + ', ' + m['state'])}",
            "link": lambda h: "yelp.com/biz/" in h and "?" not in h,
            "extra": None,
        },
        "bbb": {
            "platform": "BBB",
            "url": lambda m: f"https://www.bbb.org/search?find_country=USA&find_text=HVAC&find_loc={quote(m['city'] + ', ' + m['state'])}",
            "link": lambda h: "bbb.org" in h and "/profile/" in h,
            "extra": bbb_extra,
        },
    }


# ── Merge & score ────────────────────────────────────────────

_BIZ_STOPWORDS = re.compile(r"\b(llc|inc|co|corp|ltd|company|services?|heating|cooling|air|conditioning|hvac|the|and|&)\b")


def norm_biz(name):
    s = _BIZ_STOPWORDS.sub("", str(name or "").lower())
    return re.sub(r"[^a-z0-9]", "", s)


def score_prospect(platforms, signals, review_count, has_owner, has_email):
    """The prioritization rubric: 'paying a lot and probably
    frustrated' outranks everything else."""
    score = 0
    why = []
    if len(platforms) >= 2:
        score += 3 * (len(platforms) - 1)
        why.append(f"on {len(platforms)} lead platforms at once")
    if signals:
        score += 2 * min(len(signals), 3)
        why.append("paid placement: " + ", ".join(dict.fromkeys(signals)))
    if review_count >= 20:
        score += 1
        why.append(f"{review_count}+ reviews (active, will see outreach)")
    if has_owner:
        score += 1
        why.append("owner identified")
    if has_email:
        score += 1
    tier = "Hot" if score >= 5 else "Warm" if score >= 2 else "Cool"
    return score, tier, "; ".join(why)


def merge_and_score(partials, source_label):
    """Cross-reference is the point: the same shop found on two or more
    platforms is paying multiple lead vendors at once — the strongest
    'ripe to switch' signal there is."""
    by_key = {}
    for p in partials:
        key = norm_biz(p["business"])
        if not key:
            continue
        m = by_key.setdefault(key, {
            "business": p["business"], "first_name": "", "last_name": "",
            "city": p.get("city", ""), "zip": "", "phone": "", "email": "", "website": "",
            "platforms": [], "signals": [], "review_count": 0, "profile_urls": [], "notes": [],
        })
        if p["platform"] in LEAD_PLATFORMS and p["platform"] not in m["platforms"]:
            m["platforms"].append(p["platform"])
        for field in ("city", "zip", "phone", "email", "website"):
            if not m[field] and p.get(field):
                m[field] = p[field]
        if not m["first_name"] and p.get("first_name"):
            m["first_name"], m["last_name"] = p["first_name"], p.get("last_name", "")
        m["signals"].extend(p.get("signals", []))
        m["review_count"] = max(m["review_count"], p.get("review_count", 0))
        if p.get("profile_url"):
            m["profile_urls"].append(p["profile_url"])
        if p.get("years_in_business"):
            m["notes"].append(f"{p['years_in_business']} yrs in business")

    merged = []
    for m in by_key.values():
        score, tier, pain = score_prospect(
            m["platforms"], m["signals"], m["review_count"],
            bool(m["first_name"]), bool(m["email"]))
        merged.append({
            "business": m["business"],
            "first_name": m["first_name"], "last_name": m["last_name"],
            "city": m["city"], "zip": m["zip"],
            "phone": m["phone"], "email": m["email"], "website": m["website"],
            "platforms": ", ".join(m["platforms"]),
            "pain_signal": pain, "tier": tier, "score": score,
            "source": source_label,
            "notes": " | ".join(list(dict.fromkeys(m["notes"])) + m["profile_urls"][:2]),
        })
    merged.sort(key=lambda p: -p["score"])
    return merged


# ── Website enrichment ───────────────────────────────────────

def fetch_url(url, timeout=12):
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as res:
        return res.read(1_500_000).decode("utf-8", errors="replace")


def enrich_from_website(prospect, log):
    """The shop's own site is where a direct email usually lives.
    Returns rubric points gained so the tier can be updated."""
    website = prospect["website"]
    pages = [website]
    try:
        base = urlparse(website)
        pages.append(f"{base.scheme}://{base.netloc}/contact")
    except ValueError:
        return 0

    gained = 0
    for url in pages:
        try:
            html = fetch_url(url)
        except Exception as err:
            log(f"    (website {url} unreachable: {type(err).__name__})")
            continue
        text = re.sub(r"<[^>]+>", " ", html)
        if not prospect["email"]:
            emails = emails_from_html(html)
            if emails:
                prospect["email"] = emails[0]
                gained += 1
        if not prospect["phone"]:
            phones = phones_from_text(text)
            if phones:
                prospect["phone"] = format_phone(phones[0])
        if not prospect["first_name"]:
            owner = owner_from_text(text)
            if owner:
                prospect["first_name"], prospect["last_name"] = owner
                gained += 1
    if gained:
        prospect["score"] += gained
        prospect["tier"] = "Hot" if prospect["score"] >= 5 else "Warm" if prospect["score"] >= 2 else "Cool"
    return gained


# ── Demo data (test the tool with no scraping) ───────────────

def demo_partials(metro):
    samples = [
        ("Sample Comfort Air (SAMPLE)", "Ray", "Delgado", "78209", "(210) 555-0181", ["Thumbtack", "Angi"], ["top pro"], 47),
        ("Example Climate Pros (SAMPLE)", "Tina", "Villarreal", "78230", "(210) 555-0182", ["Angi"], ["angi certified"], 23),
        ("Placeholder Cooling LLC (SAMPLE)", "", "", "78154", "(210) 555-0183", ["Thumbtack"], [], 6),
        ("Fictional Air Services (SAMPLE)", "Walt", "Nguyen", "78023", "(210) 555-0184", ["Thumbtack", "Yelp Ads"], ["sponsored", "owner-operated (sole proprietor)"], 31),
        ("Notreal Heating & Air (SAMPLE)", "", "", "78247", "(210) 555-0185", ["Yelp Ads"], [], 12),
    ]
    partials = []
    for business, first, last, zip_, phone, platforms, signals, reviews in samples:
        for platform in platforms:
            partials.append({
                "business": business, "first_name": first, "last_name": last,
                "city": metro["city"], "zip": zip_, "phone": phone, "email": "", "website": "",
                "platform": platform, "signals": list(signals), "review_count": reviews, "profile_url": "",
            })
    return partials


# ── Output ───────────────────────────────────────────────────

def write_outputs(prospects, out_prefix):
    out = Path(out_prefix)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(f"{out}.json", "w", encoding="utf-8") as f:
        json.dump(prospects, f, indent=2)
    with open(f"{out}.csv", "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(prospects)
    print(f"\nWrote {len(prospects)} prospect(s) to:\n  {out}.csv   <- open this in Excel / Google Sheets\n  {out}.json")


# ── Main ─────────────────────────────────────────────────────

def parse_metro(m):
    parts = [s.strip() for s in str(m).split(",")]
    if len(parts) != 2 or not all(parts):
        sys.exit(f'Metro must look like "San Antonio, TX" (got "{m}")')
    city, state = parts
    return {
        "city": city, "state": state.upper(),
        "city_slug": re.sub(r"[^a-z0-9]+", "-", city.lower()),
        "state_slug": state.lower(),
    }


def main():
    sources = make_sources()
    ap = argparse.ArgumentParser(description="Find HVAC contractors paying for shared leads; write a local CSV. Sends and uploads nothing.")
    ap.add_argument("--metro", action="append", default=[], help='Metro to scan, e.g. "San Antonio, TX" (repeatable)')
    ap.add_argument("--sources", default=",".join(sources), help=f"Comma-separated subset of: {', '.join(sources)}")
    ap.add_argument("--limit", type=int, default=15, help="Max profiles per source per metro (default 15 — keep it modest)")
    ap.add_argument("--delay", type=int, default=4000, help="Base ms between page loads (default 4000)")
    ap.add_argument("--out", default="", help="Output file prefix (default out/prospects-<date>)")
    ap.add_argument("--headed", action="store_true", help="Show the browser window (lets you pass any human-check yourself)")
    ap.add_argument("--no-enrich", action="store_true", help="Skip visiting contractor websites for emails/owner names")
    ap.add_argument("--demo", action="store_true", help="Use built-in fictional sample data instead of scraping")
    args = ap.parse_args()

    metros = [parse_metro(m) for m in (args.metro or ["San Antonio, TX"])]
    chosen = [s.strip().lower() for s in args.sources.split(",") if s.strip()]
    for s in chosen:
        if s not in sources:
            sys.exit(f'Unknown source "{s}". Available: {", ".join(sources)}')

    stamp = date.today().isoformat()
    source_label = f"{'demo' if args.demo else 'scraper'} {stamp}"
    out_prefix = args.out or str(Path(__file__).parent / "out" / f"prospects-{stamp}")
    log = print

    partials = []
    if args.demo:
        print("DEMO MODE — using built-in sample contractors (no scraping, all data fictional).")
        for metro in metros:
            partials.extend(demo_partials(metro))
    else:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            sys.exit("Playwright is not installed. Run:\n  pip install playwright\n  playwright install chromium")

        with sync_playwright() as pw:
            import os
            launch_opts = {"headless": not args.headed}
            if os.environ.get("CHROMIUM_PATH"):
                launch_opts["executable_path"] = os.environ["CHROMIUM_PATH"]
            browser = pw.chromium.launch(**launch_opts)
            context = browser.new_context(viewport={"width": 1400, "height": 900}, locale="en-US")
            try:
                for metro in metros:
                    print(f"\nScanning {metro['city']}, {metro['state']} — sources: {', '.join(chosen)}")
                    for s in chosen:
                        src = sources[s]
                        partials.extend(harvest_profiles(
                            context, src["platform"], src["url"](metro), src["link"],
                            metro, args.limit, args.delay, log, src["extra"]))
            finally:
                browser.close()

    prospects = merge_and_score(partials, source_label)

    if not args.no_enrich and not args.demo:
        with_sites = [p for p in prospects if p["website"]]
        if with_sites:
            print(f"\nEnriching {len(with_sites)} prospect(s) from their own websites...")
        for p in with_sites:
            enrich_from_website(p, log)

    reachable = [p for p in prospects if p["email"] or p["phone"]]
    dropped = len(prospects) - len(reachable)
    if dropped:
        print(f"\nDropped {dropped} prospect(s) with no phone or email (no way to reach them).")
    prospects = reachable

    if not prospects:
        print("\nNo prospects collected. If sources showed block pages, try --headed, a smaller --limit, or collect a few by hand.")
        return

    tally = {"Hot": 0, "Warm": 0, "Cool": 0}
    for p in prospects:
        tally[p["tier"]] = tally.get(p["tier"], 0) + 1
    print(f"\nPipeline: {len(prospects)} prospect(s) — {tally['Hot']} Hot, {tally['Warm']} Warm, {tally['Cool']} Cool.")

    write_outputs(prospects, out_prefix)
    print("\nWork the Hot rows first — they're already sorted to the top.")


if __name__ == "__main__":
    main()

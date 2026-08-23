# Contractor Prospect Scraper (Python, standalone)

A single-file Python tool — `hvac_prospect_scraper.py` — that you run **on your own computer**. It finds HVAC contractors who are **visibly paying for shared leads** (Thumbtack, Angi, Yelp ads) in your target metros, enriches them with owner names and direct contact info (BBB profiles + the shops' own websites), scores them **Hot / Warm / Cool**, and writes a local **CSV** you open in Excel or Google Sheets.

Why this target list: a contractor already paying Thumbtack or Angi has *proven they spend money on leads* — and every shared-lead platform gives them the same reasons to switch (shared leads, ghost leads billed anyway, contract traps). Your exclusive-lead offer is the mirror image of that pain.

**This tool only collects and scores.** It sends nothing, uploads nothing, and touches nothing outside its output folder. How you contact the people on the list is entirely up to you.

> Run it from your own computer, not a cloud box — home/office IPs look like normal visitors, while datacenter IPs get bot-walled instantly by these sites.

## Setup (one time)

Install Python 3.10+ ([python.org](https://www.python.org/downloads/), check "Add to PATH" on Windows), then:

```bash
pip install playwright
playwright install chromium
```

You can keep `hvac_prospect_scraper.py` anywhere on your computer — it has no other files it depends on.

## Usage

```bash
# Default: San Antonio, all sources, 15 profiles per source:
python hvac_prospect_scraper.py

# Other metros (repeatable), fewer sources, watch the browser:
python hvac_prospect_scraper.py --metro "Austin, TX" --metro "Houston, TX"
python hvac_prospect_scraper.py --sources thumbtack,bbb
python hvac_prospect_scraper.py --headed

# Try it with fictional sample data first (no scraping at all):
python hvac_prospect_scraper.py --demo
```

Output lands in `out/prospects-<date>.csv` (+ `.json`), sorted Hot-first. All flags: `--help`.

## What each source contributes

| Source | What it proves | What we capture |
|---|---|---|
| **Thumbtack** | Paying per lead right now ("Top Pro" = heavy spender) | business, badges, review volume |
| **Angi** | Paying per lead + likely under contract ("Angi Certified") | business, badges, phone |
| **Yelp** | Paying for ad visibility | business, phone, website |
| **BBB** | Enrichment goldmine | **owner's real name**, city/zip, years in business, sole-proprietor flag |

Cross-referencing is the point: a shop found on **two or more** platforms is paying multiple lead vendors at once — the strongest "ripe to switch" signal, and it scores **Hot**. After merging, the tool visits each shop's own website for a direct email (usually the only place it's published).

## Scoring (Hot / Warm / Cool)

- +3 per lead platform beyond the first (multi-platform = spending a lot, hedging)
- +2 per paid badge/placement signal (Top Pro, Angi Certified, Sponsored, Accredited...)
- +1 active review volume (they'll actually see your outreach)
- +1 owner identified ("Hi Joe" beats "Hi there", and owner-operators feel every wasted lead dollar)
- +1 direct email found

Score ≥ 5 → **Hot**, ≥ 2 → **Warm**, else **Cool**. Work the Hot rows first.

## Ground rules

- **Public pages only.** Nothing behind a login, no captcha/anti-bot busting. If a site shows a block page, the tool skips that source and says so — run with `--headed` to pass a human-check yourself, or collect those few by hand (BBB + the shop's own site usually gets you there).
- **Polite pace.** One page at a time with multi-second randomized delays and modest default limits. You need 20 good prospects a week, not 2,000 — keep `--limit` small.
- **Rows with no phone and no email are dropped** — a prospect you can't reach isn't a prospect.

## After the scrape

Open the CSV and prune: delete franchises, out-of-area shops, and anyone already a customer. The `pain_signal` column tells you *why* each shop scored the way it did — that's also your opening line when you reach out (a Thumbtack Top Pro is paying for leads that ghost; an Angi shop is splitting every lead five ways). The full per-platform pitch playbook lives in the `hvac-contractor-poaching` skill.

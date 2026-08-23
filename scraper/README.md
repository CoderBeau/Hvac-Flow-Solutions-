# Contractor Prospect Scraper

Finds HVAC contractors who are **visibly paying for shared leads** (Thumbtack, Angi, Yelp ads) in your target metros, enriches them with owner names and direct contact info (BBB profiles + their own websites), scores them **Hot / Warm / Cool**, and loads them into the **Prospect Outreach Center** (`/prospects.html`).

Why this target list: a contractor already paying Thumbtack or Angi has *proven they spend money on leads* — and every shared-lead platform gives them the same reasons to switch (shared leads, ghost leads billed anyway, contract traps). Your exclusive-lead offer is the mirror image of that pain.

**The scraper never sends anything.** It only fills the pipeline. Every email and text waits for your approval in `prospects.html`.

## Setup (one time)

```bash
cd scraper
npm install          # installs Playwright (browser automation)
npx playwright install chromium   # if this machine has never run Playwright
```

To enable `--push` (loading results straight into your Google Sheet), either:

- copy `config.example.json` to `config.json` and fill in your Apps Script `/exec` URL and `DASHBOARD_KEY`, **or**
- set env vars `HFS_EXEC_URL` and `HFS_DASHBOARD_KEY`.

`config.json` is git-ignored — the key never lands in the repo.

Server-side requirement: the Apps Script project must include `automation/prospect-outreach.gs` (see `automation/PROSPECTS-SETUP.md`).

## Usage

```bash
# Test the whole pipeline first with fictional sample data (no scraping):
node scrape-prospects.js --demo --push

# Real run — scan San Antonio, write out/prospects-<date>.csv + .json, don't push yet:
node scrape-prospects.js

# Review the CSV, then push it:
node scrape-prospects.js --from-csv out/prospects-2026-08-23.csv --push

# Or scrape and push in one go:
node scrape-prospects.js --push

# Other metros / fewer sources / watch the browser:
node scrape-prospects.js --metro "Austin, TX" --metro "Houston, TX" --sources thumbtack,bbb --headed
```

All flags: `node scrape-prospects.js --help`

## What each source contributes

| Source | What it proves | What we capture |
|---|---|---|
| **Thumbtack** | Paying per lead right now ("Top Pro" = heavy spender) | business, badges, review volume |
| **Angi** | Paying per lead + likely under contract ("Angi Certified") | business, badges, phone (often in page data) |
| **Yelp** | Paying for ad visibility | business, phone (reliable page data), website |
| **BBB** | Enrichment goldmine | **owner's real name**, city/zip, years in business, sole-proprietor flag |

Cross-referencing is the point: a shop found on **two or more** platforms is paying multiple lead vendors at once — that's the strongest "ripe to switch" signal and scores **Hot**. After merging, the scraper visits each shop's own website for a direct email address (the best outreach channel).

## Scoring (Hot / Warm / Cool)

- +3 per lead platform beyond the first (multi-platform = spending a lot, hedging)
- +2 per paid badge/placement signal (Top Pro, Angi Certified, Sponsored, Accredited...)
- +1 active review volume (they'll actually see your outreach)
- +1 owner identified ("Hi Joe" beats "Hi there", and owner-operators feel every wasted lead dollar)
- +1 direct email found

Score ≥ 5 → **Hot**, ≥ 2 → **Warm**, else **Cool**. Work Hot first — the outreach queue already sorts that way.

## Ground rules

- **Public pages only.** Nothing behind a login, no captcha/anti-bot busting. If a site shows a block page, the scraper skips that source and tells you — collect those few by hand (BBB + the shop's own site usually gets you there) and feed them in with `--from-csv`.
- **Polite pace.** One page at a time with multi-second randomized delays, modest default limits. You need 20 good prospects a week, not 2,000 — keep `--limit` small.
- **Never pitch existing customers.** The import automatically skips anyone matching your Contractors tab, and de-dupes against prospects already in the pipeline (re-finds *merge* — new platforms/contacts are added to the existing row instead of duplicating it).
- **Compliance lives server-side** (see `automation/prospect-outreach.gs`): emails always carry your business identity, postal address, and an opt-out; first texts carry STOP; texting is blocked outside Mon–Sat 9am–7pm Central; opted-out prospects can never be contacted again.

## Hand-collected prospects

Directory markup changes and block pages are normal — manual research is a first-class path, not a fallback. Make a CSV with the same headers as the scraper's output (`business,firstName,lastName,city,zip,phone,email,website,platforms,painSignal,tier,score,source,notes` — only `business` plus one of `phone`/`email` are required) and run:

```bash
node scrape-prospects.js --from-csv my-research.csv --push
```

The playbook for finding them by hand (which badges mean "paying", the BBB → Google Business Profile → Yelp chain for owner names and direct numbers) is in the `hvac-contractor-poaching` skill's platform playbook.

# Account Config

**Fill this in once, after completing `automation/GOOGLE-ADS-MCP-SETUP.md`.** Everything else in this skill reads from here.

> Claude: if a value below still reads `<FILL IN>`, stop and tell the user exactly which line to fill. Never guess an account ID, conversion action, or resource name.

## Identifiers

| Field | Value | Where it comes from |
|---|---|---|
| Manager account (MCC) ID | `<FILL IN>` | Top-right of the manager account, format `123-456-7890` |
| Ads account customer ID | `<FILL IN>` | Top-right of the HVAC Flow Solutions ads account |
| Developer token access level | `<FILL IN — Test / Explorer / Basic>` | MCC → Tools → API Center |
| Google Cloud project ID | `<FILL IN>` | Cloud console |
| MCP server name in Claude Code | `google-ads` | The name used in `claude mcp add` |

Secrets — developer token, OAuth client secret, refresh token — live **only** in the MCP server's env vars and `~/.mcp-google-ads/`. Never in this file, never anywhere in this repo. This repo is public.

## Conversion actions

Create these in the Ads UI (Goals → Conversions → New), then record the resource names here. The build sequence attaches them to campaigns.

| Conversion | Type | Counting | Value | Resource name |
|---|---|---|---|---|
| Quote Form Submit | Website — page load on `/thanks.html` | One | `<FILL IN>` per lead | `<FILL IN>` |
| Phone Call from Ad | Calls from ads, 60s+ | One | `<FILL IN>` | `<FILL IN>` |
| Website Call Click | Clicks on `tel:+18305380713` | One | `<FILL IN>` | `<FILL IN>` |

Only **Quote Form Submit** and **Phone Call from Ad** should be marked **Primary** — those are the ones bidding optimizes toward. Website Call Click goes Secondary (observation only); it double-counts against the form on mobile.

Set conversion value to what a lead is actually worth to you, not what a job is worth to the contractor. Package math from `SETUP.md`: Starter is $150 for 10 leads = $15/lead; Growth is $375 for 25 = $15/lead; Pro Partner is $700 for 50 = $14/lead. **$15 is the honest number** for a routed lead. Use it — inflating it makes Maximize Conversion Value chase the wrong traffic.

## Naming convention

Follow it exactly. Reporting queries in `measurement.md` pattern-match on these names.

```
Campaign:  SA | <Service> | <Intent>
Ad group:  <Service> - <Modifier>
```

- `SA` — market code. Austin becomes `ATX`, Houston `HOU` when you expand.
- `<Service>` — `AC Repair`, `AC Replace`, `Heating`, `Maintenance`, `Ducts`
- `<Intent>` — `Emergency`, `Core`, `Research`

Examples:

```
SA | AC Repair | Emergency
    AC Repair - Not Cooling
    AC Repair - No Cold Air
    AC Repair - 24 Hour
SA | AC Replace | Core
    AC Replace - New Unit
    AC Replace - System Cost
```

## Account defaults

| Setting | Value | Why |
|---|---|---|
| Campaign type | Search only | Display partners waste lead-gen budget |
| Networks | Google Search only — **Search Partners OFF, Display OFF** | Partner traffic converts worse and is unattributable |
| Bidding (new campaign) | Maximize Conversions, no tCPA for first 15 conversions | tCPA before the algorithm has data throttles delivery |
| Bidding (after 15 conversions) | Maximize Conversions with tCPA | Set tCPA from real data, not a guess |
| Geo target type | **PRESENCE** — never Presence or Interest | Presence-or-Interest serves to people merely reading about San Antonio |
| Ad rotation | Optimize | |
| Ad schedule | See `san-antonio.md` § Dayparting | |
| Final URL | `https://boosthvacleads.com/get-quotes.html` | |
| Tracking template | `{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}&gclid={gclid}` | Lets the sheet trace a lead back to its campaign |

## The tracking template matters — attribution is live

The tracking template above is what fills the attribution columns in the sheet. **This wiring exists**, as of the UTM tracking commit:

- `/attribution.js` captures `utm_*`, `gclid`, `gbraid`, `wbraid`, `msclkid`, and `fbclid` on any page, stores the last non-direct touch in `localStorage` for 30 days, and falls back to referrer classification for organic traffic.
- `index.html`, `get-quotes.html`, and `docs/get-quotes.html` post that context with every homeowner lead.
- `writeHomeowner()` stores it in **Get Quotes** columns 19–22: `Keyword / Term`, `Ad Click ID`, `Landing Page`, `Referrer`. Source (col 10) and Campaign (col 11) were already there.
- The dashboard's Leads tab shows source, campaign, and search term per lead, and the search box matches on all three.

So cost per Good lead is answerable: join campaign spend from the `search` tool against Good-verdict counts grouped by the Campaign column. See `measurement.md` § Closing the loop.

**If the tracking template is missing from a campaign, `utm_term` is empty and keyword-level analysis silently degrades to campaign-level.** `gclid` still arrives — Google appends it — and `attribution.js` infers `google / cpc` from a bare gclid, so the lead is still marked as paid. But you lose the search term, which is the part that drives the negative-keyword loop. Check the tracking template on every new campaign.

Leads captured before this shipped have blank columns 19–22. That's expected; don't read it as broken tracking.

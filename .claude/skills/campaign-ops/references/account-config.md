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

## The tracking template matters

`contractor-automation.gs` writes every lead to the **Get Quotes** tab with its quality verdict. If `get-quotes.html` captures the UTM parameters into a hidden field and posts them along with the lead, the sheet can tell you *which campaign produced Good leads and which produced Bad ones*.

That wiring does not exist yet. Until it does, ad-to-lead-quality attribution is manual. Flag this to the user the first time they ask about cost per Good lead — it's a small change to `get-quotes.html` and `writeHomeowner()` in the Apps Script, and it's the highest-value thing on the whole roadmap.

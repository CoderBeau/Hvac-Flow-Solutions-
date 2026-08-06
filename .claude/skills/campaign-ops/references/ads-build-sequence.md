# Ads Build Sequence

Exact tool order for the `google-ads` MCP server ([FGRibreau/mcp-google-ads](https://github.com/FGRibreau/mcp-google-ads)).

## How every write works

The server enforces draft → confirm:

1. Call a `draft_*` / `create_*` / `update_*` tool. It returns a **plan preview and a `plan_id`**. Nothing has hit the API yet.
2. Call `confirm_and_apply(plan_id, dry_run)`.
   - `dry_run=true` (default) simulates.
   - `dry_run=false` executes. While `GOOGLE_ADS_REQUIRE_DRY_RUN=true`, executing also needs `bypass_require_dry_run=true`.
   - Destructive ops flagged `requires_double_confirm` need `confirmed_twice=true`.

**Show the user the preview between those two calls. Every time.**

New entities are created **PAUSED**. The response carries `status_after_apply` and `next_action_hint`. Enabling is `enable_entity`, and it is always a separate user request.

> On the first run in a new environment, call the server's tool list and check parameter names against what's below. This is a community server; a version bump can rename a field. If a parameter here doesn't exist, use the server's schema — it wins — and note the drift to the user.

## Full campaign build — order matters

Each step depends on the one above it. Do not reorder.

### 1. Budget + campaign

`draft_campaign`

```
name:              "SA | AC Repair | Emergency"     # naming convention in account-config.md
advertising_channel_type: SEARCH
daily_budget:      <dollars>                        # check against guardrails.md ceiling first
bidding_strategy:  MAXIMIZE_CONVERSIONS             # no tCPA until 15+ conversions
status:            PAUSED                           # explicit, never rely on the default
network_settings:  Google Search only — search partners OFF, display OFF
final_url_suffix / tracking template: see account-config.md
```

Positive location targets are set here if `draft_campaign` accepts a locations parameter. **If it does not**, the server has no dedicated add-positive-geo tool — it exposes `exclude_geo_target`, `remove_geo_target`, and `set_campaign_geo_target_type` only. In that case set the Tier 1/2 zips by hand in the UI (Campaign → Settings → Locations → Enter another location → paste the zip list) and say so clearly instead of silently skipping targeting.

Resolve zips to geo target constant IDs first — see `san-antonio.md` § Resolving geo target IDs.

### 2. Geo hardening

```
set_campaign_geo_target_type   → PRESENCE            # never PRESENCE_OR_INTEREST
exclude_geo_target             → each excluded zip from san-antonio.md
```

Do this immediately after the campaign exists, before it can ever serve.

### 3. Ad schedule

`set_campaign_schedule` — dayparting table in `san-antonio.md`.

### 4. Ad groups

`create_ad_group` per ad group in the approved package.

```
campaign:   <campaign resource name from step 1>
name:       "AC Repair - Not Cooling"
cpc_bid:    <ceiling bid>          # a safety rail under Maximize Conversions
status:     PAUSED
```

### 5. Keywords

`draft_keywords` — batch per ad group, don't call once per keyword.

Match type discipline:

- **Phrase** for symptom and service terms — the workhorse
- **Exact** for proven converters and head terms you're willing to pay up for
- **Broad only with Smart Bidding, never with Manual CPC.** The server actively blocks broad + Manual CPC. That guard is correct; don't work around it.

### 6. Negatives — before enabling, not after

`add_negative_keywords` — full list in `negative-keywords.md`.

This is the step people skip and regret. In HVAC the junk-query volume is enormous: job seekers, DIY, parts shoppers, training courses, SEO spam. Every one of those clicks is money spent to create a lead that `contractor-automation.gs` will score **Bad**.

Apply at the campaign level. Ad-group-level negatives only for cross-contamination (e.g. blocking `repair` inside the Replacement ad group).

### 7. Ads

`draft_responsive_search_ad`

API minimums: **3+ headlines, 2+ descriptions, 1 final URL.** Practical minimums for quality: 12–15 headlines, 4 descriptions, 2 RSAs per ad group.

```
ad_group:     <resource name>
headlines:    [...]                 # 30 char max each
descriptions: [...]                 # 90 char max each
final_url:    https://boosthvacleads.com/get-quotes.html
path1/path2:  "san-antonio" / "ac-repair"
```

Copy comes from `hvac-ad-campaign`. Do not write it here.

### 8. Extensions

```
draft_sitelinks              → Get Free Quotes · How It Works · Service Areas · Pricing
create_callouts              → Licensed & Insured · Same-Day Service · Free Quotes · No Obligation
create_structured_snippets   → Services: AC Repair, AC Replacement, Heating Repair, Duct Repair, Maintenance
```

Call extensions are worth more than any of these for HVAC. Add the call extension with `+18305380713` in the UI if the server exposes no tool for it.

### 9. Conversions

Conversion actions are created in the UI (see `account-config.md`), not here. If they don't exist yet, `create_conversion_action` can make them, then `set_conversion_action_primary_status` marks Quote Form Submit and Phone Call from Ad as **Primary**.

### 10. Verify before enabling

Run this and show the user the result:

```sql
SELECT campaign.id, campaign.name, campaign.status,
       campaign.bidding_strategy_type, campaign_budget.amount_micros
FROM campaign
WHERE campaign.name LIKE 'SA | %'
```

Then confirm out loud: geo type is PRESENCE, excluded zips are attached, negatives are applied, each ad group has 2 RSAs, budget matches what was approved.

### 11. Enable

`enable_entity` on the campaign — **only when the user explicitly asks.** Enable the campaign last, after ad groups.

## Incremental changes

| Ask | Tools |
|---|---|
| Add negatives from a search-term report | `search` (report) → `add_negative_keywords` → `confirm_and_apply` |
| Change a budget | `update_campaign` (check `guardrails.md`) → `confirm_and_apply` |
| Pause a campaign / ad group / keyword | `pause_entity` → `confirm_and_apply` |
| Raise a keyword bid | `update_keyword_bid` — server blocks increases over `GOOGLE_ADS_MAX_BID_INCREASE_PCT` |
| Add keywords to an existing group | `draft_keywords` → `confirm_and_apply` |
| Seasonal budget shift | `update_campaign` per campaign; state the new monthly total in dollars |

## Never do these without being asked in the current conversation

`remove_entity` · `remove_keywords` · `remove_negative_keywords` · `remove_geo_target` · `remove_extension`

All are destructive and irreversible. `remove_negative_keywords` is the sneakiest — it silently reopens spend on junk traffic. Pausing is almost always the right move instead of removing.

`apply_recommendation` is also off-limits without a specific request. Google's recommendations routinely suggest broad match expansion, Search Partners, and Display — every one of which is wrong for this account.

## Local Services Ads

**LSA campaigns cannot be created through the Google Ads API.** Creating LOCAL_SERVICES campaigns, and any ad group, ad, or criterion inside them, is unsupported.

What the API *can* do on an LSA campaign that already exists: retrieve it, change status and budget, set bidding (ManualCpa / MaximizeConversions), set ad schedule, set location targeting, and target service types.

So: stand LSA up by hand in the UI, complete Google Guaranteed verification (license, insurance, background check — allow 2–3 weeks), then manage budget and schedule from here. For HVAC in San Antonio, LSA is usually the cheapest lead source in the account. Getting verified is worth the paperwork.

Lead data from LSA is available as read-only report resources — leads, lead conversations, verification artifacts.

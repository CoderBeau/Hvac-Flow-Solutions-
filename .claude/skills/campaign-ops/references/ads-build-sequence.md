# Ads Build Sequence

Exact tool order for the `google-ads` MCP server ([FGRibreau/mcp-google-ads](https://github.com/FGRibreau/mcp-google-ads)).

Tool names and parameters below were read from the server source, not from its README — the README undercounts the surface. There are **51 tools**, including dedicated report tools that are better than raw GAQL for routine work.

## How every write works

The server enforces draft → confirm:

1. Call a `draft_*` / `create_*` / `update_*` tool. It returns a **plan preview and a `plan_id`**. Nothing has hit the API yet.
2. Call `confirm_and_apply(plan_id, dry_run)`.
   - `dry_run` **defaults to `true`** — it simulates.
   - `dry_run=false` executes. While `GOOGLE_ADS_REQUIRE_DRY_RUN=true`, that is rejected unless `bypass_require_dry_run=true` is also set.
   - Destructive ops need `confirmed_twice=true`.

**Show the user the preview between those two calls. Every time.**

New entities are created **PAUSED**. Enabling is `enable_entity`, and it is always a separate user request.

## Customer ID is per call

Every tool takes an **optional `customer_id`**, falling back to `GOOGLE_ADS_CUSTOMER_ID` when omitted. One server instance handles every account under the manager — no second registration when you add a metro or a second ad account. Pass `customer_id` explicitly whenever working outside the default account, and say which account you're touching.

`list_accounts` enumerates what's reachable (all sub-accounts when an MCC is configured). `health_check` verifies config and credentials — run it first when anything looks wrong.

## Full campaign build

### 1. Resolve geo target IDs

```
search_geo_targets(query: "78209")
```

Dedicated tool — don't hand-write GAQL against `geo_target_constant`. Confirm the result is the Texas postal code before using it; US zips aren't unique in that table. Details in `san-antonio.md`.

### 2. Campaign, budget, ad group, and keywords — one call

`draft_campaign` does more than its name suggests. It creates the budget, the campaign, a first ad group, its keywords, and positive geo targeting together:

```
campaign_name:     "SA | AC Repair | Emergency"     # naming convention in account-config.md
daily_budget:      <dollars>                        # check guardrails.md ceiling first
bidding_strategy:  MAXIMIZE_CONVERSIONS             # target_cpa / target_roas optional
channel_type:      SEARCH                           # defaults to SEARCH
ad_group_name:     "AC Repair - Not Cooling"
keywords:          [ ... with match types ... ]
geo_target_ids:    [ ... from step 1 ... ]
language_ids:      [ ... ]
status:            PAUSED                           # omit and it defaults to PAUSED anyway
customer_id:       <optional>
```

Positive geo targeting is handled here — **no UI fallback needed**. `update_campaign` also carries positive geo targeting for changes after launch.

### 3. Geo hardening

```
set_campaign_geo_target_type(positive_geo_target_type: "PRESENCE")
exclude_geo_target(campaign_id, geo_target_id)      # each excluded zip
```

Do this immediately, before the campaign can ever serve. `PRESENCE_OR_INTEREST` is the **API default** — if you skip this call you get the wrong behavior silently.

`exclude_geo_target` adds a negative criterion. `remove_geo_target` is different: it strips a location that is already positively targeted, and a negative criterion would collide with the existing positive one. Use exclude for zips you never targeted, remove for trimming ones you did. `remove_geo_target` is destructive and needs `confirmed_twice`.

### 4. Ad schedule

`set_campaign_schedule` — dayparting table in `san-antonio.md`.

### 5. Additional ad groups

`create_ad_group` for every ad group beyond the one `draft_campaign` made. Then `draft_keywords` for each.

Match type discipline:
- **Phrase** for symptom and service terms — the workhorse
- **Exact** for proven converters
- **Broad only with Smart Bidding, never Manual CPC.** The server blocks that combination. The guard is correct; don't work around it.

### 6. Negatives — before enabling, not after

`add_negative_keywords` — full list in `negative-keywords.md`. Campaign level.

The step people skip and regret. HVAC junk-query volume is enormous, and every one of those clicks buys a lead that `contractor-automation.gs` will score **Bad**.

`get_negative_keywords` reads back what's applied.

### 7. Ads

`draft_responsive_search_ad`. API minimums are 3 headlines, 2 descriptions, 1 final URL; practical minimums are 12–15 headlines, 4 descriptions, 2 RSAs per ad group. Copy comes from `hvac-ad-campaign`.

### 8. Extensions

```
draft_sitelinks · create_callouts · create_structured_snippets
```

`list_extensions` reads back what's attached. There is **no call-extension tool** — add the call extension with `+18305380713` in the UI. For HVAC that extension is worth more than all three of the above, so don't treat it as optional.

### 9. Conversion actions — read this carefully

**`create_conversion_action` does not create website or form conversions.** It creates `UPLOAD_CLICKS` actions only — gclid-based offline conversion import. Your Quote Form Submit and Phone Call from Ad actions must be created in the **UI** (see `account-config.md` Step 9).

What the tool is genuinely for is the Good-lead feedback loop — see `measurement.md` § Offline conversion import.

`get_conversion_actions` lists what exists. `set_conversion_action_primary_status` marks Primary (counts in the Conversions column and feeds Smart Bidding) or Secondary (observation only). Use it to demote a signal that would otherwise dilute the bidding goal.

### 10. Verify before enabling

```
get_campaign_performance      # confirms the campaign exists and its settings
get_negative_keywords         # confirms negatives applied
list_extensions               # confirms extensions attached
```

Then confirm out loud: geo type is PRESENCE, excluded zips attached, negatives applied, 2 RSAs per ad group, budget as approved, everything still PAUSED.

### 11. Enable

`enable_entity` on ad groups, then the campaign — **only when the user explicitly asks.**

## Incremental changes

| Ask | Tools |
|---|---|
| Add negatives from search terms | `get_search_terms` → `add_negative_keywords` → `confirm_and_apply` |
| Change a budget | `update_campaign` (check `guardrails.md`) |
| Pause anything | `pause_entity` |
| Raise a keyword bid | `update_keyword_bid` — server blocks increases over `GOOGLE_ADS_MAX_BID_INCREASE_PCT` |
| Add keywords | `draft_keywords` |
| Check disapprovals | `get_policy_issues` |
| Find new keyword ideas | `discover_keywords` (Keyword Planner), `get_keyword_forecasts` |

`resolve_entity_id_for_status` and `resolve_ad_composite_id` translate names to the IDs the status tools need.

## Never without being asked in the current conversation

`remove_entity` · `remove_keywords` · `remove_negative_keywords` · `remove_geo_target` · `remove_extension`

All irreversible. `remove_negative_keywords` is the sneakiest — it silently reopens spend on junk traffic. Pausing is almost always right instead.

`apply_recommendation` is also off-limits without a specific request; Google routinely recommends broad match expansion, Search Partners, and Display, all wrong for this account. `list_recommendations` and `dismiss_recommendation` are fine to use freely.

For a hard stop, set `GOOGLE_ADS_BLOCKED_OPS` — see `guardrails.md`.

## Local Services Ads

**LSA campaigns cannot be created through the Google Ads API.** Creating LOCAL_SERVICES campaigns, and any ad group, ad, or criterion inside them, is unsupported.

What the API *can* do on an existing LSA campaign: retrieve it, change status and budget, set bidding (ManualCpa / MaximizeConversions), set ad schedule, set location targeting, target service types.

Stand LSA up by hand in the UI, complete Google Guaranteed verification (license, insurance, background check — allow 2–3 weeks), then manage budget and schedule from here. In San Antonio it's usually the cheapest lead source in the account.

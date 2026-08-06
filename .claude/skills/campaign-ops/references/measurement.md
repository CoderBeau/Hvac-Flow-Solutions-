# Measurement

All read-only — safe to run without a confirm step.

**Prefer the dedicated report tools over raw GAQL.** The server ships purpose-built reports that default to the last 30 days and return clean output. `run_gaql` is the escape hatch for anything they don't cover (it supports `json`, `table`, and `csv` output).

Costs come back in **micros** where raw GAQL is used — divide by 1,000,000. Always present dollars; never hand the user a micros number.

## Routine reports

| Question | Tool |
|---|---|
| How is each campaign doing? | `get_campaign_performance` |
| Which keywords earn their spend? | `get_keyword_performance` (includes quality score, match type) |
| What did people actually search? | `get_search_terms` (top 200 by clicks) |
| Which zips convert? | `get_geo_performance` |
| Which ads and headlines work? | `get_ad_performance` |
| What's disapproved? | `get_policy_issues` |
| What negatives are applied? | `get_negative_keywords` |
| What accounts can I reach? | `list_accounts` |
| Is the server configured right? | `health_check` |

## Wasted spend — run this weekly

```
get_search_terms(customer_id?, date range)
```

Then filter for terms with clicks and **zero conversions**. Highest-value routine check in the account; output feeds `add_negative_keywords`.

Note the cap: `get_search_terms` returns the top 200 by clicks. That's ample for one metro, but if you're ever running enough volume to truncate, fall back to `run_gaql` with an explicit `LIMIT` and ordering:

```sql
SELECT search_term_view.search_term, campaign.name,
       metrics.clicks, metrics.cost_micros, metrics.conversions
FROM search_term_view
WHERE segments.date DURING LAST_30_DAYS
  AND metrics.clicks > 2
  AND metrics.conversions = 0
ORDER BY metrics.cost_micros DESC
LIMIT 500
```

## What's working

Same `get_search_terms` output, filtered for terms **with** conversions. Two uses: promote strong terms to exact match, and hand the expensive ones to `seo-content.md` as blog topics — anything costly in paid is a candidate for organic.

## Budget starvation

Not covered by a dedicated tool — use `run_gaql`:

```sql
SELECT campaign.name, campaign_budget.amount_micros,
       metrics.search_budget_lost_impression_share,
       metrics.search_impression_share
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
```

Above ~20% budget-lost impression share means qualified traffic is going unserved. During peak that argues for more budget — but check cost per Good lead first. Losing impression share on traffic that converts badly is fine.

## Closing the loop with the sheet

The Google Ads number is cost per **conversion**. The number that matters is cost per **Good lead**. Google can't see the difference; `contractor-automation.gs` can.

UTM capture is live — `/attribution.js` on the site, columns 19–22 in the **Get Quotes** tab.

1. `get_campaign_performance` and `get_search_terms` for the period
2. Pull the **Get Quotes** tab for the same period
3. Group leads by the **Campaign** column (11) and **Keyword / Term** (19); count Good / Needs Review / Bad
4. **Cost per Good lead** = campaign spend ÷ Good leads

| Pattern | Read | Action |
|---|---|---|
| High conversions, high Bad rate | Wrong searcher | Add negatives; tighten match types |
| Low conversions, high Good rate | Small but qualified | Raise budget — scale this one |
| High cost per Good lead in a zip | Wrong neighborhood | Move zip to exclusions |
| Good leads clustering on a term | Found the vein | Exact match it, raise its bid, write the blog post |

Leads predating attribution have blank columns 19–22. Exclude them from the join rather than counting them as unattributed paid traffic.

## Offline conversion import — the endgame

This is what capturing `gclid` was for, and it's the highest-leverage thing available once a few weeks of data exist.

Smart Bidding optimizes toward the conversions it can see — form fills, including the junk ones. It has no idea which leads your scorer rejected. Offline conversion import fixes that at the source: you tell Google *which clicks became Good leads*, and bidding starts chasing those.

The mechanism:

1. `create_conversion_action` with type `UPLOAD_CLICKS` — call it something like `Good Lead`. This is the **only** kind of conversion action this tool creates; website and call conversions are UI-only.
2. After apply, the numeric ID is the trailing segment of the returned `conversionAction` resource name. Record it in `account-config.md`.
3. Feed it the gclids from **Get Quotes** column 20 where **Lead Quality** is Good, with the lead's timestamp and a $15 value.
4. `set_conversion_action_primary_status` — make `Good Lead` **Primary** and demote the raw form conversion to **Secondary**.

After step 4, Maximize Conversions is optimizing for leads your pipeline will actually route, not for form fills. No competitor buying shared leads can do this, because they don't own the scoring.

Don't attempt it until there's real data. The scorer needs enough Good verdicts for Google to learn from — 30+ over 30 days is a reasonable floor. Raise it with the user when the volume is there; don't set it up on day one.

## Reporting format

1. **Spend** — total, and versus the prior period
2. **Leads** — conversions, and Good leads if the sheet is available
3. **Cost per lead** — and cost per Good lead when known
4. **One thing to change this week** — one, not a list

A report without a recommendation is homework.

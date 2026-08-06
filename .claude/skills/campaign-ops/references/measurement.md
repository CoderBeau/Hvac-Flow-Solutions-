# Measurement

GAQL queries for the `search` tool. All read-only — safe to run without a confirm step.

Customer ID comes from `account-config.md`.

## Account health

```sql
SELECT campaign.name, campaign.status,
       metrics.impressions, metrics.clicks, metrics.ctr,
       metrics.average_cpc, metrics.cost_micros,
       metrics.conversions, metrics.cost_per_conversion
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
  AND campaign.status != 'REMOVED'
ORDER BY metrics.cost_micros DESC
```

Costs come back in **micros** — divide by 1,000,000 for dollars. Always present dollars; never hand the user a micros number.

## Wasted spend — run this weekly

```sql
SELECT search_term_view.search_term, campaign.name, ad_group.name,
       metrics.clicks, metrics.cost_micros, metrics.conversions
FROM search_term_view
WHERE segments.date DURING LAST_30_DAYS
  AND metrics.clicks > 2
  AND metrics.conversions = 0
ORDER BY metrics.cost_micros DESC
LIMIT 100
```

Highest-value routine query in the account. Output feeds `add_negative_keywords`.

## What's working

```sql
SELECT search_term_view.search_term, campaign.name,
       metrics.clicks, metrics.conversions, metrics.cost_per_conversion
FROM search_term_view
WHERE segments.date DURING LAST_30_DAYS
  AND metrics.conversions > 0
ORDER BY metrics.conversions DESC
```

Two uses: promote strong terms to exact match, and feed the expensive ones to `seo-content.md` as blog topics.

## Keyword performance

```sql
SELECT ad_group_criterion.keyword.text,
       ad_group_criterion.keyword.match_type,
       ad_group.name,
       metrics.clicks, metrics.cost_micros, metrics.conversions,
       ad_group_criterion.quality_info.quality_score
FROM keyword_view
WHERE segments.date DURING LAST_30_DAYS
  AND ad_group_criterion.status = 'ENABLED'
ORDER BY metrics.cost_micros DESC
```

Quality Score under 5 means ad relevance or landing page experience is off — usually the ad group is too broad. Split it rather than raising bids.

## Geo performance — the zip tier check

```sql
SELECT campaign.name,
       geographic_view.country_criterion_id,
       segments.geo_target_most_specific_location,
       metrics.clicks, metrics.cost_micros, metrics.conversions
FROM geographic_view
WHERE segments.date DURING LAST_30_DAYS
ORDER BY metrics.cost_micros DESC
```

Validates the Tier 1/2/3 split in `san-antonio.md`. Zips with spend and no conversions after 30 days move to the exclusion list.

## Hour and day

```sql
SELECT campaign.name, segments.day_of_week, segments.hour,
       metrics.clicks, metrics.conversions, metrics.cost_micros
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
```

Tunes the dayparting table with real data instead of assumptions.

## Budget starvation

```sql
SELECT campaign.name, campaign_budget.amount_micros,
       metrics.search_budget_lost_impression_share,
       metrics.search_impression_share
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
```

`search_budget_lost_impression_share` above ~20% means you're leaving qualified traffic on the table. During peak season that's the argument for raising budget — but check cost per Good lead first. Losing impression share on traffic that converts badly is fine.

## Closing the loop with the sheet

The Google Ads number is cost per **conversion**. The number that matters is cost per **Good lead**. Google can't see the difference; `contractor-automation.gs` can.

UTM capture is live — `/attribution.js` on the site, columns 19–22 in the **Get Quotes** tab. The analysis is:

1. Pull spend + conversions by campaign (and by search term) for the period
2. Pull the **Get Quotes** tab for the same period
3. Group leads by the **Campaign** column (col 11) and **Keyword / Term** (col 19), count Good / Needs Review / Bad
4. Compute **cost per Good lead** = campaign spend ÷ Good leads

Campaign names in the sheet match the Google Ads campaign names exactly, because the tracking template passes `{campaignid}` and the naming convention is stable — join on either.

Then act:

| Pattern | Read | Action |
|---|---|---|
| High conversions, high Bad rate | Attracting the wrong searcher | Add negatives; tighten match types |
| Low conversions, high Good rate | Small but qualified | Raise budget — this is the campaign to scale |
| High cost per Good lead in a zip | Wrong neighborhood | Move zip to exclusions |
| Good leads clustering on one term | Found the vein | Exact match it, raise its bid, and write the blog post |

For leads predating attribution, columns 19–22 are blank. Exclude those rows from the join rather than counting them as unattributed paid traffic.

## Reporting format

Give the user, in this order:

1. **Spend** — total, and versus the prior period
2. **Leads** — conversions, and Good leads if the sheet is available
3. **Cost per lead** — and cost per Good lead when known
4. **One thing to change this week** — one, not a list

A report without a recommendation is homework. End with the single highest-value action.

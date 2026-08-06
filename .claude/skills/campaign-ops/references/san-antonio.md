# San Antonio Market

Everything geo-specific. Reuse this file's structure when opening a new metro.

## Targeting model

Target **zip codes, not the city**. City-level targeting in San Antonio pulls in Bexar County's low-income rental belt, where AC calls end up being landlord decisions that never convert to a paid job. Zip targeting is the single biggest lever on lead quality here.

Set geo target type to **PRESENCE** on every campaign. The default (Presence or Interest) serves ads to anyone *researching* San Antonio — including out-of-state people shopping a rental property. Those become Bad leads.

## Zip tiers

### Tier 1 — Replacement money (bid highest)

Older housing stock plus owner-occupied plus income. These produce full-system replacement leads, the most valuable thing a contractor can get.

| Zip | Area | Why |
|---|---|---|
| 78209 | Alamo Heights / Terrell Hills | 1940s–60s homes, high income, aging ducted systems |
| 78212 | Monte Vista / Olmos Park | Historic homes, expensive retrofits |
| 78213 | Castle Hills | 1950s–70s, owner-occupied |
| 78230 | Northwest / Oak Hills | 1970s–80s, systems at end of life |
| 78231 | Shavano Park | High income, large homes, multi-system |
| 78232 | Hollywood Park | 1970s, established |
| 78248 | Northwest hills | 1980s, owner-occupied |
| 78257 | The Dominion | High income, large homes |
| 78258 | Stone Oak | 1990s–2000s, first replacement cycle now |
| 78259 | Stone Oak north | Same cycle |
| 78260 | Timberwood Park | Larger lots, multi-system homes |

### Tier 2 — Repair volume (standard bid)

Owner-occupied, mid-income. Good repair flow, some replacement.

`78201` · `78216` · `78228` · `78229` · `78233` · `78239` · `78240` · `78247` · `78249` · `78250` · `78251` · `78253` · `78254` · `78255` · `78256` · `78261`

### Tier 3 — Suburban ring (add after Tiers 1–2 prove out)

Outside Bexar but inside a reasonable service radius. Confirm a contractor actually covers these before enabling — routing in `contractor-automation.gs` matches on the contractor's `Service Areas` field, and a lead for a city nobody covers strands.

| Zip | City |
|---|---|
| 78006 | Boerne |
| 78015 | Boerne / Fair Oaks Ranch |
| 78023 | Helotes |
| 78108 | Cibolo |
| 78109 | Converse |
| 78148 | Universal City |
| 78154 | Schertz |
| 78163 | Bulverde |
| 78266 | Garden Ridge |

### Exclude

Add as negative locations from day one: `78202` `78203` `78207` `78210` `78211` `78214` `78220` `78221` `78223` `78224` `78225` `78226` `78227` `78237` `78242`.

High-rental, low owner-occupancy. Not a judgment about the neighborhoods — it's that a renter can't authorize a $9,000 system replacement, so the lead scores Bad and burns a contractor's cap. Revisit if you ever add a landlord/property-manager product.

## Resolving geo target IDs

The API needs geo target constant IDs, not zip strings. Do not hardcode them and do not guess. Resolve via the `search` tool:

```sql
SELECT geo_target_constant.id,
       geo_target_constant.name,
       geo_target_constant.canonical_name,
       geo_target_constant.country_code,
       geo_target_constant.target_type
FROM geo_target_constant
WHERE geo_target_constant.country_code = 'US'
  AND geo_target_constant.target_type = 'Postal Code'
  AND geo_target_constant.name = '78209'
```

Check `canonical_name` contains `Texas` before using an ID — US postal codes are not unique across the geo target table.

## Seasonality

South Texas is a cooling market. Budget accordingly — this is not a 12-even-months business.

| Period | Demand | Budget |
|---|---|---|
| Mar–Apr | Ramping — first hot days, tune-up season | 100% baseline |
| **May–Sep** | **Peak. 100°F+ stretches. Emergency AC is most of the volume.** | **150–200%** |
| Oct–Nov | Falling off | 75% |
| Dec–Feb | Trough, punctuated by hard freezes | 50%, with a freeze plan |

**Emergency budget rule:** the first 100°F day and any hard freeze both produce a demand spike that outruns a daily budget cap within hours. When the forecast shows either, raise budgets *the day before* — not the morning of. Ads that hit their cap by 10am miss the afternoon panic calls, which are the highest-intent leads of the year.

Heating is a real but short window. Do not build heating campaigns in June.

## Dayparting

HVAC lead intent is not evenly distributed.

| Window | Modifier | Reason |
|---|---|---|
| Mon–Fri 6am–9am | +15% | Woke up to a hot house |
| Mon–Fri 9am–5pm | Baseline | |
| Mon–Fri 5pm–9pm | +20% | Home from work, problem is undeniable |
| Sat–Sun 7am–7pm | +25% | Weekend breakdowns, competitors' phones are off |
| All days 9pm–6am | −50% or off | Form fills at 2am skew junk; nobody's routing them until morning |

For a true 24/7 emergency campaign, run overnight hours but only on `emergency`/`24 hour`/`right now` keyword variants.

## Competitive note

San Antonio HVAC paid search is expensive and crowded — regional players plus private-equity-backed consolidators bidding aggressively on `ac repair san antonio`. Do not fight head-on for the fattest head term. Win on:

1. **Service + neighborhood specificity** — `ac repair stone oak`, `ac replacement alamo heights`. Lower volume, materially lower CPC, higher intent.
2. **Emergency modifiers** — `24 hour ac repair san antonio`, `emergency ac repair near me`. The consolidators bid these too, but intent is high enough to justify the click.
3. **Symptom language** — `ac not cooling`, `ac blowing warm air`. These map directly onto the Good keywords in `contractor-automation.gs`, which means they pre-qualify: someone typing a symptom already has a broken system.

Before any launch, run a live check of who is actually bidding — market composition shifts. `hvac-ad-campaign` Step 2 covers this.

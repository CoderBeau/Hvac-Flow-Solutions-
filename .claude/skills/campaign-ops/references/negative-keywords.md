# Negative Keywords

Apply the master list at campaign level **before** any campaign is enabled.

## Why this list is different

Most negative lists are generic. This one is derived from `DEFAULT_BAD_KEYWORDS` in `automation/contractor-automation.gs` — the terms that already cause a lead to be scored **Bad** and blocked from routing.

That gives an unusual guarantee: a search term matching one of these produces a lead your own pipeline will refuse to route. You'd pay for the click, store the row, and route nothing. These aren't low-quality clicks; they're guaranteed-zero clicks.

Keep the two lists in sync. When you add a Bad keyword in the sheet's **Keywords** tab, add the ad-side equivalent here.

## Master list — every campaign

### Employment (from `DEFAULT_BAD_KEYWORDS` — the biggest single leak in HVAC search)

```
jobs · job · job opening · hiring · careers · career · employment · apply
resume · looking for work · salary · pay · wage · how much do hvac techs make
apprentice · apprenticeship · technician jobs · hvac jobs near me
```

HVAC job-seeker query volume rivals homeowner volume. Without these you will spend real money on people looking for work.

### Training and education

```
school · schools · training · certification · certified · course · courses
class · classes · degree · epa 608 · license · licensing · how to become
trade school · homework · school project · student
```

### DIY and parts

```
diy · do it yourself · how to · how to fix · fix my own · repair myself
tutorial · youtube · manual · pdf · wiring diagram · schematic
parts · parts only · just a part · capacitor · contactor · fuse · filter
replacement filter · air filter · buy parts · amazon · home depot · lowes
```

### Warranty and home-warranty (from `DEFAULT_BAD_KEYWORDS`)

```
home warranty · warranty claim · warranty company · american home shield
choice home warranty · covered under warranty · is it covered
```

Home-warranty holders are looking for their warranty company's dispatch, not a paid contractor. They convert into leads and then refuse the visit.

### Free and price-shopping

```
free · for free · no charge · free service · free repair · free ac
cheap · cheapest · discount · coupon · groupon · rebate only
just curious · just looking · price check
```

Keep `free estimate` and `free quote` **positive** — those are your offer. Only the standalone `free` variants are negative. Use phrase-match negatives so you don't accidentally block them.

### Marketing and B2B spam (from `DEFAULT_BAD_KEYWORDS`)

```
seo · web design · website design · backlink · guest post · promote your
marketing services · sell you · selling leads · buy leads · lead generation
sponsor · wholesale · crypto · bitcoin · loan · casino
```

Ironic but necessary: you sell HVAC leads, so agencies searching `hvac lead generation` will click your homeowner ads. Different funnel — that's what `hvac-contractor-poaching` is for, and it must not draw from the homeowner budget.

### Rental and commercial

```
apartment · apartments · landlord · tenant · renter · property management
hoa · commercial · industrial · warehouse · restaurant · rooftop unit · rtu
```

Renters can't authorize the work. Commercial is a different trade with different contractors — exclude until you have contractors who take commercial and a `Service Areas` field that reflects it.

### Wrong product

```
window unit · portable ac · portable air conditioner · swamp cooler
evaporative cooler · space heater · fireplace · water heater · plumbing
plumber · electrician · roofing · appliance repair · refrigerator
car ac · auto ac · vehicle · rv
```

`water heater` and `car ac` are the two highest-volume misfires in this category. Do not skip them.

### Research and non-commercial

```
what is · why does · meaning · definition · vs · versus · reddit
forum · reviews of · complaints · lawsuit · scam · bbb
history of · how does it work · calculator · chart · sizing chart
```

### Competitor and platform

```
angi · angies list · thumbtack · homeadvisor · networx · modernize
yelp · nextdoor · craigslist · facebook marketplace
```

You compete with these for contractor spend. Don't pay for clicks from homeowners already inside their funnels.

### Geography outside the market

```
austin · houston · dallas · fort worth · el paso · corpus christi
laredo · mcallen · waco · new mexico · mexico
```

Belt and braces. PRESENCE targeting should handle it, but explicit negatives cost nothing and catch queries that name another city.

## Ad-group cross-contamination

Beyond the master list:

| Ad group | Negatives |
|---|---|
| AC Replace | `repair` `fix` `service call` `tune up` `recharge` `refrigerant` |
| AC Repair | `install` `installation` `new unit` `new system` `replace` `cost to replace` |
| Maintenance | `emergency` `not cooling` `broken` `wont turn on` |
| Heating | `ac` `air conditioning` `cooling` |

Without these, your Replacement ad group — which carries the highest bids — soaks up cheap repair queries and blows the budget on low-value leads.

## Ongoing maintenance

Run this weekly for the first month, then every two weeks:

```sql
SELECT search_term_view.search_term,
       campaign.name,
       metrics.clicks,
       metrics.cost_micros,
       metrics.conversions
FROM search_term_view
WHERE segments.date DURING LAST_30_DAYS
  AND metrics.clicks > 2
  AND metrics.conversions = 0
ORDER BY metrics.cost_micros DESC
```

Anything with spend and no conversions is a negative-keyword candidate. Show the user the list, let them approve, then `add_negative_keywords`.

**The compounding version** — now available, since the sheet records the search term per lead in **Get Quotes** column 19: cross-reference paid search terms against leads scored **Bad**.

That surfaces terms which convert on paper but produce garbage — a term with 4 conversions and 4 Bad verdicts looks like a winner in Google Ads and is pure loss to you. Invisible to Google, obvious in your own data, and the reason you can run this account tighter than any competitor.

Run it alongside the zero-conversion query above; the two catch different failures.

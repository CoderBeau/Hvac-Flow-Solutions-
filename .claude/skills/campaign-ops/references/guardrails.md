# Guardrails

Two layers: the server enforces the first, Claude enforces the second. Both matter — the server can't tell a smart change from a dumb one, it only knows limits.

## Server-enforced (env vars, set in `claude mcp add`)

| Variable | Value | Server default | Effect |
|---|---|---|---|
| `GOOGLE_ADS_REQUIRE_DRY_RUN` | `true` | `true` | Every apply simulates unless explicitly bypassed |
| `GOOGLE_ADS_MAX_DAILY_BUDGET` | `150` | `50` | Hard-rejects any campaign budget above this |
| `GOOGLE_ADS_MAX_BID_INCREASE_PCT` | `50` | — | Blocks bid increases over this percentage |
| `GOOGLE_ADS_BLOCKED_OPS` | see below | *(empty)* | Comma-separated list of tools the server refuses outright |
| `GOOGLE_ADS_AUDIT_LOG` | `~/.mcp-google-ads/audit.log` | same | Every mutation logged with timestamp and dry-run status |
| `GOOGLE_ADS_READ_ONLY` | `false` | `false` | Set `true` to freeze the account entirely |

`GOOGLE_ADS_MAX_DAILY_BUDGET` is your protection against a misplaced decimal turning $80/day into $800/day. Note the server's own default is `50` — set it explicitly or an $80/day campaign is rejected. Raise it deliberately for peak season, then lower it again in October.

**`GOOGLE_ADS_BLOCKED_OPS` is the strongest guardrail available** and it's empty by default. It refuses named tools at the server, below any judgment Claude applies. For this account:

```
GOOGLE_ADS_BLOCKED_OPS=remove_entity,remove_keywords,remove_negative_keywords,remove_geo_target,remove_extension,apply_recommendation
```

Those are exactly the irreversible operations plus the one that lets Google change your account on its own advice. Nothing in normal operation needs them — pausing covers every routine case. If you genuinely need to remove something, edit the env var deliberately and re-add the server; the friction is the point.

The server also blocks broad match combined with Manual CPC. Don't route around it.

## Claude-enforced

### Budget ceilings

| Scope | Normal | Peak (May–Sep) |
|---|---|---|
| Single campaign daily | $100 | $150 |
| Account daily total | $250 | $400 |
| Account monthly | $7,500 | $12,000 |

Above these, stop and get the number stated in the conversation. "Increase the budget" is not authorization for a specific amount — ask for the amount.

State every budget change in **dollars per day and dollars per month**. `daily_budget: 80` doesn't register; "$80/day, about $2,400/month" does.

### Requires explicit approval in the current conversation

- Enabling any campaign for the first time
- Any budget increase
- Removing anything — keywords, negatives, geo targets, extensions, entities
- Adding broad match keywords
- Enabling Search Partners or Display
- Applying a Google recommendation
- Changing bidding strategy on a campaign with live conversion data

### Never, regardless of instruction

- Enabling a campaign in the same step that creates it
- `confirm_and_apply` with `dry_run=false` before the user has seen the preview
- Removing negative keywords in bulk
- Changing geo target type to `PRESENCE_OR_INTEREST`
- Putting the developer token, OAuth secret, or refresh token in any file in this repo

That last one is not a style preference. This repo is public and serves `boosthvacleads.com`. A leaked developer token means someone else spending your money.

## Sanity checks before any apply

Run through these and say the answers out loud:

1. **Budget** — daily × 30. Is the monthly number what the user expects?
2. **Geo** — PRESENCE? Excluded zips attached?
3. **Negatives** — applied *before* enabling, not after?
4. **Final URL** — `get-quotes.html`, not the homepage? The homepage doesn't convert paid traffic.
5. **Status** — everything PAUSED?
6. **Match types** — any broad match sneaking in?
7. **Conversion actions** — attached, with Quote Form Submit as Primary?

Any "no" gets fixed before applying, not noted as a follow-up.

## Kill switch

If spend looks wrong or something is clearly misconfigured:

```
pause_entity  → the campaign
confirm_and_apply(plan_id, dry_run=false, bypass_require_dry_run=true)
```

Pause first, diagnose after. A paused campaign costs nothing; a misconfigured live one costs money every minute. Never `remove_entity` in a panic — pausing is reversible, removing is not.

## Weekly rhythm

| When | Do |
|---|---|
| Every Monday | Search-term report → propose negatives |
| Every Monday | Spend vs conversions by campaign; flag anything above target cost per lead |
| Every 2 weeks | Cross-reference ad leads against the sheet's Good/Bad verdicts |
| Monthly | Budget reallocation by seasonality table in `san-antonio.md` |
| Before a heat wave or freeze | Raise budgets **the day before** — see § Emergency budget rule |

## The number that matters

Not clicks, not impressions, not conversions. **Cost per Good lead.**

A $22 lead that scores Good and routes to a contractor beats a $9 lead that scores Bad, gets stored, and routes to nobody. Google optimizes toward conversions it can see, which means form fills — including the junk ones. Your sheet knows which were real. Report both numbers whenever the data exists, and when they disagree, trust the sheet.

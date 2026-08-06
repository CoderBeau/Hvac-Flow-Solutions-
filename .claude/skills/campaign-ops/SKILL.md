---
name: campaign-ops
description: Execute marketing campaigns end-to-end for HVAC Flow Solutions in the San Antonio, Texas market — build and launch Google Ads search campaigns through the google-ads MCP server, write and publish SEO blog posts into this repo, and close the loop between ad spend and lead quality from the Google Sheet. Use this whenever the user wants to launch, run, build, pause, adjust, or optimize a campaign; add or cut keywords; change budgets or bids; write a blog post or landing page for search; check what ads are spending or which leads they produced; or asks anything about San Antonio targeting, zip codes, or cost per lead. Handles both paid (Google Ads) and organic (SEO content) in one workflow — use it even when the user names only one of them.
---

# Campaign Ops — HVAC Flow Solutions

This skill is the **execution layer**. It knows the account, the market, the guardrails, and the exact tool sequence to make a change real.

Two other skills already exist and hold the strategy:

| Skill | Owns | This skill's relationship |
|---|---|---|
| `hvac-ad-campaign` | *What* the campaign should be — keywords, RSA copy, match types, budgets | Call it to design. Never re-derive its output here. |
| `seo-rank-engine` | *What* content should rank — intent, on-page, E-E-A-T, local SEO | Call it to plan content. Never re-derive its output here. |

**Division of labor:** those skills decide, this skill executes. If a request needs design *and* execution, run the design skill first, show the plan, then execute here.

## Non-negotiables

1. **Never apply a write without showing the preview first.** Every mutation goes `draft_*` → show the user the plan → `confirm_and_apply`. No exceptions, no "this one's small."
2. **Never enable a campaign in the same step you create it.** Everything lands PAUSED. Enabling is a separate, explicitly requested action.
3. **Never exceed the budget ceiling** in `references/guardrails.md` without the user stating the new number in the current conversation.
4. **Read `references/account-config.md` before the first Google Ads tool call in a session.** It holds the live IDs. If placeholders are still unfilled, stop and tell the user which ones — do not guess an ID.

## Routing

Match the request, then read only the reference files listed.

| Request looks like | Read |
|---|---|
| "Launch / build / set up a campaign", "run ads in X" | `account-config.md`, `san-antonio.md`, `ads-build-sequence.md`, `negative-keywords.md`, `guardrails.md` |
| "Add / cut keywords", "add negatives", "raise bids", "change budget" | `account-config.md`, `ads-build-sequence.md` (§ Incremental changes), `guardrails.md` |
| "Pause / enable / stop" | `account-config.md`, `guardrails.md` |
| "How's it doing", "what did we spend", "which leads came from ads" | `account-config.md`, `measurement.md` |
| "Write a blog post", "we need a page for X", "rank for X" | `seo-content.md`, `san-antonio.md` |
| "Full launch for [service/area]" — ads **and** content | All of the above, in the order in § Full market launch |

## Standing context

Do not ask the user for any of this. It is fixed.

- **Business:** HVAC Flow Solutions — lead generation. Ads capture homeowner leads; leads are scored and routed to contractor customers.
- **Market:** San Antonio, Texas (Bexar County + surrounding). `ACTIVE_CITY` in `automation/contractor-automation.gs` is the source of truth; it currently reads `San Antonio`.
- **Site:** `boosthvacleads.com`
- **Landing page for all lead-gen ads:** `https://boosthvacleads.com/get-quotes.html`
- **Conversion page:** `https://boosthvacleads.com/thanks.html`
- **Phone:** (830) 538-0713 / `tel:+18305380713`
- **Services offered** (exact values in the `get-quotes.html` service dropdown): AC Repair · AC Replacement / New Unit · Heating Repair · Heating Replacement · Full System Installation · Maintenance / Tune-Up · Duct Cleaning / Repair · Not Sure – Need Inspection
- **Urgency values:** Today / Emergency · This Week · Just Getting Quotes

The ads exist to produce leads that score **Good** in the sheet. A cheap lead that scores Bad is worth less than nothing — it burns a contractor's cap. Optimize for cost per *Good* lead, never cost per raw conversion.

## Full market launch

When the user asks for a complete launch, run this order and stop at each checkpoint:

1. **Design the ads** — invoke `hvac-ad-campaign` with the San Antonio brief from `references/san-antonio.md`. Output is the campaign package.
2. **Show the package.** Wait for approval before touching the account.
3. **Build in Google Ads** — follow `references/ads-build-sequence.md` exactly. Everything lands PAUSED.
4. **Show the preview.** Get an explicit go-ahead.
5. **Apply**, then report what was created with its resource names.
6. **Enable** only when the user says to.
7. **Design the content** — invoke `seo-rank-engine` for the matching organic plan.
8. **Publish** per `references/seo-content.md` — write the page into this repo, commit, push.
9. **Set the review date** — 14 days out, per `references/measurement.md`.

Steps 1–6 and 7–9 are independent. If Google Ads is blocked (token pending, server down), do 7–9 anyway and say what you skipped.

## Reporting back

After any change, state plainly:

- What was created or modified, with resource names
- Its status (PAUSED / ENABLED) — always say this, never let the user assume
- Daily and monthly budget implications in dollars
- What still needs doing by hand in the Google Ads UI

If a tool call fails, quote the API error. Do not retry a mutation blind — a failed mutate may have partially applied, so re-query state before trying again.

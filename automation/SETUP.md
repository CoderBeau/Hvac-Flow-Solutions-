# HVAC Flow Solutions — Automation Setup Guide

## How It Works

**Homeowner submits "Get Quotes":**
- The lead is **scored against your Good/Bad keyword lists** (the "Keywords" tab) and stamped **Good**, **Needs Review**, or **Bad**
- Row added to the **Get Quotes** tab with the verdict, score, and which keywords matched
- You get an admin email with the verdict in the subject line (e.g. `[GOOD LEAD]`)
- Homeowner gets an instant SMS confirmation (if Twilio is configured)
- **Good and Review leads** are auto-routed by email + SMS to the contractor in their city with the fewest leads sent so far (round-robin), skipping anyone who has hit their package's lead cap. The sheet records who each lead went to.
- **Bad leads are saved but never routed** — job seekers, spam, and solicitors don't burn a contractor's lead cap. Overturn any verdict from the dashboard; marking a Bad lead Good routes it on the spot.
- ~24 hours later, if no follow-up has been logged yet, the homeowner gets a check-in SMS asking if a contractor reached out (skipped for Bad leads)

**Lead Dashboard (`dashboard.html`):**
- Live view of every lead (filter Good / Review / Bad, search, reclassify), every contractor (status, leads used vs cap, trial dates, one-click pause/resume), and both keyword lists (add/remove without touching the sheet)
- Lives at `boosthvacleads.com/dashboard.html` — it is locked behind the `DASHBOARD_KEY` you set below and is excluded from search engines

**Contractor signs up (paid package):**
- Row added to the **Contractors** tab
- You get an admin email + SMS
- Contractor gets a welcome email with a Stripe payment link, plus a welcome SMS
- The row starts as **Pending Payment** — no leads route until Stripe confirms payment
- The `checkout.session.completed` webhook flips them to **Active** automatically
- Once active, they're in the round-robin rotation up to their package's lead cap

**Contractor signs up for a free trial:**
- Row added to both the **Trials** tab (legal/signature record) and the **Contractors** tab (so they're included in lead routing immediately, uncapped)
- You and the contractor both get an email + SMS with their Client ID and trial dates
- 14 days after the trial starts, it automatically expires — see below

**Lead caps (hard stop):**
- Each paid package has a lead limit. The moment a contractor's "Leads Sent" count reaches their cap, their Status is set to `Limit Reached` and both you and the contractor get an SMS. They're skipped in routing until you manually reactivate them (e.g. after renewal).

**Trial expiration (automatic):**
- A daily check looks for any Contractor row with a Trial End Date in the past and `Status = Active`. It flips Status to `Trial Expired`, and SMS's both the contractor and you. No leads go to them after that.

**Manual control (you, anytime):**
- Open the Google Sheet, click the **HVAC Admin** menu, select a row on the **Contractors** tab, and choose **Pause Leads for Selected Row** or **Resume Leads for Selected Row**. This works on any contractor — paid, trial, capped, or expired.

> **Note:** The Vapi AI voice agent on the site is a separate, already-configured system and is not touched by this script.

---

## What You Need

| Service | Purpose | Cost |
|---|---|---|
| **Stripe** (stripe.com) | Card checkout for every package, membership, and the trial | 2.9% + 30¢ per charge |
| **Twilio** (twilio.com) | SMS only — texts homeowners, contractors, and you | ~$1/mo + $0.0075/text |

SMS is fully optional. If Twilio isn't configured, the script silently skips sending texts and everything else (email, sheets, routing, caps, trial expiry) still works.

Stripe is **not** optional — until the payment links are filled in (Step 0), every checkout button on the site falls back to a "call us to pay" message with the office number.

---

## Step 0 — Stripe Payment Links (do this first, ~20 min)

Checkout is Stripe Payment Links — hosted pages that take any debit or credit card.
**Nobody has to create an account or log in to pay.**

### 0a. Create the products

Stripe Dashboard > **Product catalogue** > **Add product**. Create these nine:

| Product | Price | Billing |
|---|---|---|
| Starter Membership | $397 | **Recurring — monthly** |
| Growth Membership | $697 | **Recurring — monthly** |
| Pro Membership | $997 | **Recurring — monthly** |
| Tester Pack | $75 | One-off |
| Starter Pack | $150 | One-off |
| Growth Pack | $375 | One-off |
| Pro Partner Pack | $700 | One-off |
| Elite Pack | $1,300 | One-off |
| 14-Day Trial | $25 | One-off |

The three memberships **must** be recurring/monthly — that's what makes the monthly fee charge itself.

### 0b. Create a payment link for each

**Payment links** > **New** > pick the product > **Create link**.
On each link, open **After payment** > **Confirmation page** > **Redirect to a page** and enter:

```
https://boosthvacleads.com/thanks.html
```

### 0c. Paste the links into the site

Open **`/payment-links.js`** in the repo root — that is the only file with checkout URLs in it.
Replace each `REPLACE_WITH_STRIPE_PAYMENT_LINK` with the matching `https://buy.stripe.com/...` URL.

Then open **`automation/contractor-automation.gs`** and paste the *same* URLs into the
`STRIPE_LINKS` block near the top, so the "complete your payment" email points at the same checkout.

Any link left blank simply shows a "call (830) 538-0713 to pay" card instead — nothing breaks.

### 0d. Turn on automatic activation (the webhook)

Contractors are written to the sheet as **Pending Payment**, and leads are only routed to
**Active** rows. This webhook flips them to Active the moment Stripe confirms payment.

1. In Apps Script: **Project Settings > Script Properties** > add
   `STRIPE_WEBHOOK_TOKEN` = a long random string you make up.
2. In Stripe: **Developers > Webhooks > Add endpoint**. URL:

   ```
   https://script.google.com/macros/s/<YOUR_DEPLOY_ID>/exec?stripeToken=<that same string>
   ```

3. Select the event **`checkout.session.completed`**, then save.

Without this, paid contractors sit at Pending Payment until you flip them to Active by hand
on the Contractors tab (or from the dashboard). Payments still go through either way.

> Apps Script web apps can't read request headers, so Stripe's signature header can't be
> verified. The random token in the URL is what protects the endpoint — keep it secret. The
> handler can only ever mark a row Active; it never moves money.

### 0e. Turn on PayPal as a payment option (optional, ~2 min)

Stripe can show a **PayPal** button on the same checkout page as the card form, so contractors
who prefer PayPal — or want to pay from a PayPal balance — get that choice, without adding any
PayPal code back to the site.

1. Stripe Dashboard > **Settings > Payments > Payment methods**
2. Find **PayPal** and click **Turn on**
3. For the three memberships, confirm **recurring payments** are enabled for PayPal. Stripe turns
   this on automatically for most accounts, but PayPal's own regional rules mean it sometimes has
   to be enabled by hand on this screen.

This applies to your existing payment links — you do **not** need to recreate them. Open one link
in a browser afterwards to confirm the PayPal button appears.

Fees differ: PayPal runs about **3.49% + fixed fee** versus **2.9% + 30¢** for cards, so a $697
membership costs roughly $4 more per month when someone pays with PayPal.

Card remains the default and still needs no account. The site copy already reads
"card, Apple Pay, or PayPal — no account needed to pay by card", so it is accurate either way:
if you leave PayPal off, the button simply doesn't appear at checkout.

---

## Sales Demo Mode

Two tools for showing the system to a contractor **without touching live data**.

### Live demo lead — `demo.html`

Open `https://boosthvacleads.com/demo.html?access=hfs-m-2f5bc259c054da0914085ac7`
(same invite token as the pricing page). Enter the prospect's cell and/or email, and a
sample lead lands on **their** phone in seconds — the same email and SMS a paying
contractor gets, formatted identically.

The demo path is sealed off from live operations. It never:

- writes to the **Get Quotes** tab
- reads or writes the **Contractors** tab
- calls `forwardLeadToContractor()`
- increments anyone's **Leads Sent** or burns a lead cap

Demo submissions land on their own **Demo Leads** tab (purple header). The lead is still
scored by the real keyword engine, so the quality verdict you show is genuine.

> ⚠️ Never demo by submitting the real `get-quotes.html` form. That routes a fake homeowner
> to a real paying contractor **and** spends one of their paid leads.

**To test it from the Apps Script editor**, pick **`testDemoLead`** in the function dropdown and
press Run. It sends a sample lead to your own `ADMIN_EMAIL` and `ADMIN_PHONE` and logs the result.

> The Run button calls the selected function **with no arguments**. `handleDemoLead`,
> `writeDemoLead` and `apiDemoLead` all take parameters, so running them directly throws
> `TypeError: Cannot read properties of undefined`. That's the editor passing nothing in — not a
> broken script. Always run `testDemoLead` instead.

### Dashboard demo — `dashboard.html?demo=1`

Renders a built-in sample dataset — 34 leads, 5 contractors, realistic mix of Good/Review/Bad.
No network call, **no `DASHBOARD_KEY` needed**, and every edit button is disabled. A purple
DEMO MODE bar sits across the top so nobody mistakes it for live numbers.

Use this instead of your real dashboard on a sales call: the live one shows actual homeowner
names, phone numbers, and emails, plus the names of your other contractor customers.

---

## Step 1 — Twilio (SMS only, 5 min)

1. Sign up at **twilio.com**
2. Go to **Phone Numbers > Buy a number** — any US number (~$1/month)
3. Note your Account SID, Auth Token, and phone number

---

## Step 2 — Google Apps Script

1. Open your Google Sheet > **Extensions > Apps Script**
2. Delete existing code, paste the full contents of `contractor-automation.gs`
3. Click the gear icon > **Script Properties**, add all 6:

| Property | Value |
|---|---|
| `TWILIO_SID` | Your Twilio Account SID |
| `TWILIO_TOKEN` | Your Twilio Auth Token |
| `TWILIO_FROM` | Your Twilio number, e.g. `+12105551234` |
| `ADMIN_PHONE` | Your cell, e.g. `+12105559999` |
| `DASHBOARD_KEY` | A long random password for the dashboard (30+ characters — treat it like a password). The dashboard API refuses every request until this is set. |
| `STRIPE_WEBHOOK_TOKEN` | A long random string, repeated in the Stripe webhook URL as `?stripeToken=...` (Step 0d). Paid contractors stay at Pending Payment until this is set. |

4. Click **Deploy > New Deployment**
   - Type: **Web App** | Execute as: **Me** | Access: **Anyone**
   - **Access must be "Anyone"** — the website forms and the Stripe webhook both call this URL without signing in to Google.
5. Point your forms (`contractor-form.html`, `get-quotes.html`, `contractor-trial.html`) at the deployed Web App URL if they aren't already.

---

## Updating the script later (READ THIS BEFORE YOU RE-PASTE)

Apps Script serves the **last deployed version**, not whatever is currently in the editor.
Pasting new code and hitting **Save** changes nothing for the live site — you have to publish
a new version.

**Deploy > Manage deployments >** pencil/**Edit** icon **> Version: New version > Deploy**

That keeps the **same `/exec` URL**, which is what you want.

> ⚠️ Do **not** use **Deploy > New deployment** for an update. That mints a *different* `/exec`
> URL, and the old one goes stale — every form on the site would silently stop writing to the
> sheet. Six files hardcode the current URL (`index.html`, `pricing.html`, `contractor-form.html`,
> `contractor-trial.html`, `get-quotes.html`, and `dashboard.html`), so a
> new URL means editing all of them plus re-pointing the Stripe webhook.

Re-deploy this way any time you change the script **or** its Script Properties.

### Redeploy checklist

Most things survive a redeploy. The list below is short on purpose — **only the "check" column
needs your attention.**

**✅ Survives automatically — do NOT redo these**

| Thing | Why it's safe |
|---|---|
| All 6 Script Properties | Stored on the project, not the code. Never cleared by pasting or deploying. |
| The `/exec` URL | Unchanged as long as you use **Edit → New version** (not *New deployment*). |
| Triggers (`sendHomeownerFollowUps`, `runDailyMaintenance`) | Attached to the project, not the deployment. They keep firing. |
| Stripe webhook endpoint | Points at the same `/exec` URL, so nothing to re-enter. |
| Deployment access = "Anyone" | Kept when you edit an existing deployment. |
| Every sheet tab and all your data | Untouched by deploys. |

**⚠️ Check these — pasting the whole file overwrites in-code settings**

Pasting `contractor-automation.gs` replaces everything, including any value you edited
*inside the code*. After each paste, confirm these still say what you want (all are near
the top of the file):

1. **`ACTIVE_CITY`** — line ~36. Ships as `'San Antonio'`. **If you've expanded to another
   city, a paste silently reverts it and leads route to the wrong place.** This is the one
   that bites.
2. **`STRIPE_LINKS`** — the 8 payment links. Kept in the repo, so a paste from GitHub is
   correct. Only an issue if you created new links and didn't push them here.
3. **`PACKAGE_LEAD_CAPS` / `MEMBERSHIP_LEAD_CAPS`** — lead limits per tier.
4. **`ADMIN_EMAIL`**, **`TRIAL_LENGTH_DAYS`**, **`HOMEOWNER_FOLLOWUP_HOURS`**.

Keyword lists live on the **Keywords** tab of the sheet, not in the code, so editing them
from the dashboard is safe from any paste.

**The actual routine, every time**

1. Paste the new `contractor-automation.gs` over `Code.gs`
2. Skim the config block at the top (items 1–4 above)
3. Save (⌘S)
4. **Deploy → Manage deployments → Edit → Version: New version → Deploy**
5. Run **`testDemoLead`** from the function dropdown — confirms email + SMS still work
6. Only if you renamed or removed a scheduled function: re-run **`installTriggers`**
   (safe to re-run any time; it replaces rather than duplicates)

> If the editor asks you to authorize again after a paste, that's normal — new code using a
> Google service for the first time re-prompts for permission. Accept it and continue.

## Step 3 — Install Triggers (run once)

In the Apps Script editor, select the `installTriggers` function from the dropdown and click **Run** once. This sets up:
- `sendHomeownerFollowUps` — runs hourly, sends the 24h check-in SMS to homeowners who haven't gotten one yet
- `runDailyMaintenance` — runs daily at 8am, checks for and expires trials past their end date

You only need to do this once. If you ever re-run it, it safely replaces the old triggers instead of duplicating them.

---

## Step 4 — The Lead Dashboard

1. Set the `DASHBOARD_KEY` Script Property (Step 2) and re-deploy the web app
2. Open `boosthvacleads.com/dashboard.html`
3. Paste your web app `/exec` URL (prefilled) and your `DASHBOARD_KEY`, click **Connect**

Both values are stored only in that browser. Anyone without the key gets nothing — every dashboard request is rejected server-side.

**What you can do from it:**
- **Leads tab** — every lead with its Good / Needs Review / Bad verdict, score, and the exact keywords that fired. Filter, search, and reclassify: marking a Bad lead **Good** routes it to a contractor immediately; marking a lead **Bad** just records the verdict (it never un-sends a routed lead).
- **Contractors tab** — status, package, leads used vs cap with a progress bar, trial end dates, renewal dates. Pause / Resume / Reactivate any contractor with one click (same effect as the HVAC Admin sheet menu).
- **Keywords tab** — add or remove Good/Bad keywords; changes write straight to the sheet's **Keywords** tab and apply to the very next lead.

**How scoring works:** every lead starts at 0. Good keyword hit `+10`, bad keyword hit `-15`, urgency today/emergency `+15` (this week `+5`), valid phone `+5` (missing/fake phone `-15`), link in the notes `-25`. Score ≥ 10 → **Good**, score < 0 → **Bad**, in between → **Needs Review**. Matching is whole-word and case-insensitive. Thresholds live at the top of `contractor-automation.gs` (`GOOD_THRESHOLD` / `BAD_THRESHOLD`).

---

## Step 5 — Migrating an Existing Sheet (only if upgrading)

If your **Contractors** or **Get Quotes** tabs already have data from an older version of this script, run these once from the Apps Script editor to add the new columns without losing existing rows:

- `migrateContractorsSheet` — adds `Lead Cap`, `Trial End Date`, `Client ID` columns, and backfills `Lead Cap` for existing contractors based on their package
- `migrateGetQuotesSheet` — adds the `Follow-up Sent`, `SMS Consent`, `Lead Quality`, `Quality Score`, `Matched Keywords`, `Routed To`, `Keyword / Term`, `Ad Click ID`, `Landing Page`, and `Referrer` columns (22 total), and creates the **Keywords** tab seeded with the default lists

Then open the sheet and run **HVAC Admin > Rescore All Unscored Leads** to score your existing rows (it never overwrites a verdict and never re-routes anything).

Skip this step entirely on a brand-new sheet — `ensureContractorsHeaders` and `writeHomeowner` create the right columns automatically.

---

## Step 6 — Test Everything

Run these functions from the Apps Script editor (Logger output will confirm what happened):

| Function | What it tests |
|---|---|
| `testSMS` | Sends a test text to `ADMIN_PHONE` — confirms Twilio is wired up correctly |
| `testHomeowner` | Simulates a homeowner lead — checks scoring, Get Quotes row, email, SMS, and routing |
| `testLeadScoring` | Runs 5 sample leads through the keyword scorer and logs each verdict (writes nothing) |
| `testLeadRouting` | Shows which contractor would receive the next lead |
| `testTrial` | Simulates a trial signup — checks Trials row, Contractors row, email, and SMS |

---

## Lead Caps by Package

| Package | Lead Cap |
|---|---|
| Tester | 5 |
| Starter | 10 |
| Growth | 25 |
| Pro Partner | 50 |
| Elite | 100 |
| Trial | Unlimited (until trial expires) |

To change a cap, edit `PACKAGE_LEAD_CAPS` near the top of `contractor-automation.gs`. To change the trial length, edit `TRIAL_LENGTH_DAYS`.

---

## Google Sheets Tabs

| Tab | Contents |
|---|---|
| Get Quotes | Every homeowner lead submitted via the site, with its quality verdict, score, matched keywords, who it was routed to, and the ad attribution it arrived with (source, campaign, search term, click ID) |
| Contractors | Every paid contractor + every trial contractor — this is the source of truth for lead routing, caps, and status |
| Trials | Legal/signature record for trial signups (Client ID, dates, e-signature link) |
| Keywords | Good/Bad keyword lists used to score every incoming lead — edit here or from the dashboard |

> After updating `contractor-automation.gs` in the Apps Script editor, you must **re-deploy** (Deploy → Manage deployments → Edit → New version) for changes to go live.

---

## Related — Marketing Automation

This guide covers the **lead pipeline** (forms → sheet → scoring → routing). The other half — how leads get *created* — is documented separately:

- **`automation/GOOGLE-ADS-MCP-SETUP.md`** — connect Google Ads to Claude Code so campaigns can be built, adjusted, and reported on by command. Start-to-finish, with every copy/paste step for the manager account.
- **`.claude/skills/campaign-ops/`** — the ops skill that executes those campaigns and publishes SEO content. Loads automatically when working in this repo.

The two halves are designed to meet: the Bad keyword list in `contractor-automation.gs` seeds the ad negative-keyword list, and the Good/Bad verdicts in the **Get Quotes** tab are what ad spend should ultimately be judged against — not Google's raw conversion count.

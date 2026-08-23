# Prospect Outreach Center — Setup Guide

The growth engine that fills your contractor pipeline. Three pieces, built to work together:

1. **The scraper** (`scraper/`) finds HVAC contractors who are *visibly paying* for shared leads (Thumbtack, Angi, Yelp ads), enriches them with owner names + direct contact info, scores them Hot/Warm/Cool, and loads them into a new **Prospects** tab of your existing Google Sheet.
2. **The drafting engine** (`automation/prospect-outreach.gs`) writes a personalized, pain-led 4-touch outreach sequence for every prospect — the Thumbtack pitch for Thumbtack pros, the Angi pitch for Angi pros — using the same wedge as your sales demo: *exclusive leads vs. shared leads*.
3. **The approval queue** (`prospects.html` on your site) shows you each drafted message. You edit if you want, press **Send**, and it goes out through the same Gmail/Twilio you already use. **Nothing ever sends without your click.**

The sequence per prospect:

| Touch | When | Channel | Content |
|---|---|---|---|
| 1 | Day 0 | Email | Pain-led opener (platform-specific) + free sample lead offer |
| 2 | +2 days | SMS | Short intro text, free sample offer, STOP opt-out |
| 3 | +3 days | Email | $75 Tester pack risk-reversal |
| 4 | +4 days | Email | Break-up ("I'll stop here...") |

The clock only ever schedules the *next* touch after you send or skip one — it can't fire anything on its own.

---

## Step 1 — Add the script file (5 min)

1. Open your Google Sheet > **Extensions > Apps Script** (the same project that runs `contractor-automation.gs`).
2. Click **Files +** > **Script**, name it `prospect-outreach`, and paste the full contents of `automation/prospect-outreach.gs`.
3. **Also re-paste the updated `automation/contractor-automation.gs`** over your existing Code.gs — this version has two small hooks that route prospect requests to the new file (search it for "prospectApi" and "ProspectImport" to see them).
4. Save (⌘S).

## Step 2 — Add your business address (1 min)

**Project Settings (gear) > Script Properties** > add:

| Property | Value |
|---|---|
| `BUSINESS_ADDRESS` | Your physical mailing address, e.g. `123 Main St, San Antonio, TX 78201` |

Every outreach email prints this in its footer. CAN-SPAM requires a real postal address on commercial email — a P.O. Box or registered-agent address works. Until it's set, a visible placeholder is used and prospects.html shows a warning banner.

## Step 3 — Redeploy (1 min)

**Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy.**

Same rule as always: *never* "New deployment" for an update — that changes the `/exec` URL and breaks every form on the site (see SETUP.md).

## Step 4 — Test it end-to-end (5 min)

1. In the Apps Script editor, run **`testSeedProspects`** from the function dropdown. It adds three clearly-marked TEST prospects whose email is *your* admin email — so sending "to them" emails you.
2. Open `boosthvacleads.com/prospects.html`. It uses the same saved connection as your lead dashboard — if this browser is already connected to dashboard.html, just hit Connect.
3. The Send Queue shows the TEST prospects with their drafted openers. Read one — notice the Thumbtack prospect got the "paying for ghosts" pitch and the Angi one got the "splitting leads 5 ways" pitch.
4. Edit anything, press **Send email**, and check your inbox: that's exactly what a real prospect receives.
5. Try **Skip this touch**, mark one **Replied**, mark one **Opted Out**. Then delete the TEST rows from the Prospects tab whenever you like.

Also try **`testDraftSequence`** (dropdown > Run > check the Execution log) to read a full 4-touch sequence without writing anything.

## Step 5 — Optional: morning digest (1 min)

Run **`installProspectTriggers`** once from the editor. Every morning at 8am, if any prospects are due for their next touch, you get one email: who's due, which touch, which channel — with a link to the queue. It reminds; it never sends outreach itself.

## Step 6 — Fill the pipeline

Two ways, both land in the same queue:

- **The scraper** — see `scraper/README.md`. Start with `--demo --push` to watch sample data flow through, then do a real run.
- **By hand** — the **Add Prospect** tab in prospects.html, or a CSV via `--from-csv` (great for prospects you find on your phone: a Thumbtack Top Pro you noticed, a shop with an angry "Angi wasted my money" Google review reply).

---

## Day-to-day workflow (the 10-minute morning routine)

1. Open **prospects.html** (or click through from the digest email).
2. **Send Queue** is sorted Hot first. For each card: read the draft, tweak if you want, **Send**. Skip a touch that doesn't fit; hit **They replied** the moment someone answers (that freezes their sequence — from there it's a sales conversation, and when they sign up they go through the normal contractor flow).
3. When a text is due outside Mon–Sat 9am–7pm Central, the Send button waits — send it during business hours.
4. **They replied → close them:** offer the free sample lead (use demo.html — the sample lead lands on *their* phone during the call), then the $75 Tester pack. Mark **Won** when they sign up.

## Compliance — what's enforced for you

| Rule | How it's enforced |
|---|---|
| Email identity + postal address + opt-out (CAN-SPAM) | Footer appended server-side to every outreach email, even if edited out |
| First text identifies the business + STOP opt-out (TCPA hygiene) | Baked into the drafts; STOP auto-appended to a first text if edited out |
| No texting at night / Sundays | SMS sends blocked outside Mon–Sat 9am–7pm Central |
| Opt-outs are forever | An Opted Out prospect is blocked from every future send |
| Never pitch an existing customer | Imports & manual adds are checked against your Contractors tab and rejected on match |
| Honest claims only | Drafts use documented platform pain points and your real prices; if you change the Tester pack, update `TESTER_PRICE` in prospect-outreach.gs |

One manual duty: **when someone replies STOP to a text or "no thanks" to an email, mark them Opted Out in prospects.html right away.** Twilio can also be configured to auto-block STOP repliers — do both.

If outreach volume grows past a handful of texts a day, move texting to a registered business-texting setup (A2P 10DLC registration on your Twilio number) — flag this to your Twilio console, it's a form, not a project.

## New sheet tabs

| Tab | Contents |
|---|---|
| **Prospects** | Every contractor prospect: contact info, platforms they pay for, pain signal, Hot/Warm/Cool tier, sequence stage, next-touch date, status |
| **Outreach Log** | Every touch ever sent (or skipped): timestamp, channel, recipient, the exact subject + body that went out |

Everything else (Get Quotes, Contractors, Trials, Keywords, routing, caps, Stripe) is untouched by this feature.

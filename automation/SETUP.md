# HVAC Flow Solutions — Automation Setup Guide

## How It Works

**Homeowner submits "Get Quotes":**
- Row added to the **Get Quotes** tab
- You get an admin email
- Homeowner gets an instant SMS confirmation (if Twilio is configured)
- The lead is auto-routed by email + SMS to the contractor in their city with the fewest leads sent so far (round-robin), skipping anyone who has hit their package's lead cap
- ~24 hours later, if no follow-up has been logged yet, the homeowner gets a check-in SMS asking if a contractor reached out

**Contractor signs up (paid package):**
- Row added to the **Contractors** tab
- You get an admin email + SMS
- Contractor gets a welcome email with a PayPal payment link, plus a welcome SMS
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
| **Twilio** (twilio.com) | SMS only — texts homeowners, contractors, and you | ~$1/mo + $0.0075/text |

SMS is fully optional. If Twilio isn't configured, the script silently skips sending texts and everything else (email, sheets, routing, caps, trial expiry) still works.

---

## Step 1 — Twilio (SMS only, 5 min)

1. Sign up at **twilio.com**
2. Go to **Phone Numbers > Buy a number** — any US number (~$1/month)
3. Note your Account SID, Auth Token, and phone number

---

## Step 2 — Google Apps Script

1. Open your Google Sheet > **Extensions > Apps Script**
2. Delete existing code, paste the full contents of `contractor-automation.gs`
3. Click the gear icon > **Script Properties**, add all 4:

| Property | Value |
|---|---|
| `TWILIO_SID` | Your Twilio Account SID |
| `TWILIO_TOKEN` | Your Twilio Auth Token |
| `TWILIO_FROM` | Your Twilio number, e.g. `+12105551234` |
| `ADMIN_PHONE` | Your cell, e.g. `+12105559999` |

4. Click **Deploy > New Deployment**
   - Type: **Web App** | Execute as: **Me** | Access: **Anyone**
5. Point your forms (`contractor-form.html`, `get-quotes.html`, `contractor-trial.html`) at the deployed Web App URL if they aren't already.

---

## Step 3 — Install Triggers (run once)

In the Apps Script editor, select the `installTriggers` function from the dropdown and click **Run** once. This sets up:
- `sendHomeownerFollowUps` — runs hourly, sends the 24h check-in SMS to homeowners who haven't gotten one yet
- `runDailyMaintenance` — runs daily at 8am, checks for and expires trials past their end date

You only need to do this once. If you ever re-run it, it safely replaces the old triggers instead of duplicating them.

---

## Step 4 — Migrating an Existing Sheet (only if upgrading)

If your **Contractors** or **Get Quotes** tabs already have data from an older version of this script, run these once from the Apps Script editor to add the new columns without losing existing rows:

- `migrateContractorsSheet` — adds `Lead Cap`, `Trial End Date`, `Client ID` columns, and backfills `Lead Cap` for existing contractors based on their package
- `migrateGetQuotesSheet` — adds the `Follow-up Sent` column

Skip this step entirely on a brand-new sheet — `ensureContractorsHeaders` and `writeHomeowner` create the right columns automatically.

---

## Step 5 — Test Everything

Run these functions from the Apps Script editor (Logger output will confirm what happened):

| Function | What it tests |
|---|---|
| `testSMS` | Sends a test text to `ADMIN_PHONE` — confirms Twilio is wired up correctly |
| `testHomeowner` | Simulates a homeowner lead — checks Get Quotes row, email, SMS, and routing |
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
| Get Quotes | Every homeowner lead submitted via the site |
| Contractors | Every paid contractor + every trial contractor — this is the source of truth for lead routing, caps, and status |
| Trials | Legal/signature record for trial signups (Client ID, dates, e-signature link) |

> After updating `contractor-automation.gs` in the Apps Script editor, you must **re-deploy** (Deploy → Manage deployments → Edit → New version) for changes to go live.

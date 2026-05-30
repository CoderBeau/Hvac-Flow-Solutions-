# Contractor Signup Automation — Setup Guide

## How It Works

**On contractor signup:**
- Contractor fills out the form → they get a welcome text instantly
- You get an admin alert with their name, company, package, and areas

**When a homeowner calls the Vapi AI number on your site:**
1. The AI agent answers, introduces itself, and has a natural conversation
2. It collects: caller's name, city, HVAC problem description, urgency, and best callback number
3. When the call ends, Vapi fires a webhook to your Google Apps Script
4. Every contractor signed up for that city gets an SMS with:
   - Homeowner's name and callback number
   - Problem description and urgency
   - Link to the full call recording
5. You also get the same alert as admin
6. Every call is logged to the "AI Calls" tab in Google Sheets

---

## What You Need

| Service | Purpose | Cost |
|---|---|---|
| **Vapi** (vapi.ai) | AI voice agent — answers calls, captures lead info, records | ~$0.05–0.10/min |
| **Twilio** (twilio.com) | SMS only — texts contractors and you | ~$1/mo + $0.0075/text |

You do **not** need Twilio for calls or phone numbers. Vapi handles all of that.

---

## Step 1 — Twilio (SMS only, 5 min)

1. Sign up at **twilio.com**
2. Go to **Phone Numbers > Buy a number** — any US number (~$1/month)
3. Note your Account SID, Auth Token, and phone number

---

## Step 2 — Google Apps Script (10 min)

1. Open your Google Sheet > **Extensions > Apps Script**
2. Delete existing code, paste the full contents of `contractor-automation.gs`
3. Click the gear icon > **Script Properties**, add all 6:

| Property | Value |
|---|---|
| `TWILIO_SID` | Your Twilio Account SID |
| `TWILIO_TOKEN` | Your Twilio Auth Token |
| `TWILIO_FROM` | Your Twilio number, e.g. `+12105551234` |
| `ADMIN_PHONE` | Your cell, e.g. `+12105559999` |
| `SHEET_ID` | The long ID from your Google Sheet URL |
| `VAPI_SECRET` | Make up any random string, e.g. `hvac-secret-2026` |

4. Click **Deploy > New Deployment**
   - Type: **Web App** | Execute as: **Me** | Access: **Anyone**
5. Copy the Web App URL — you'll need it in Step 4

---

## Step 3 — Vapi Setup (15 min)

### 3a. Create account
Sign up at **vapi.ai**, go to **Assistants > Create Assistant**.

### 3b. System prompt (paste this in the "System" field)
```
You are an AI receptionist for HVAC Flow Solutions, a Texas HVAC lead service.
Your job is to have a friendly, natural conversation to capture homeowner lead info.

Ask for:
1. Their first name
2. Which Texas city they are in (San Antonio, Houston, Dallas, Austin, Fort Worth, or El Paso)
3. What HVAC problem they are having — let them describe it in their own words
4. How urgent it is (emergency / today / this week / just getting quotes)
5. The best phone number to reach them (confirm it vs the number they called from)

Keep it conversational — do not read a list of questions robotically. Acknowledge what
they say before moving to the next question. When you have all five pieces of info,
tell them a local HVAC contractor will call them back shortly, thank them, and end the call.
```

### 3c. Structured data schema (in Assistant > Analysis > Structured Data)
Paste this JSON schema so Vapi extracts clean fields from every call:
```json
{
  "type": "object",
  "properties": {
    "callerName":    { "type": "string",  "description": "Homeowner first name" },
    "city":          { "type": "string",  "description": "Texas city: San Antonio, Houston, Dallas, Austin, Fort Worth, or El Paso" },
    "problem":       { "type": "string",  "description": "HVAC issue description" },
    "urgency":       { "type": "string",  "description": "emergency / today / this week / getting quotes" },
    "callbackPhone": { "type": "string",  "description": "Best callback phone number" }
  },
  "required": ["callerName", "city", "problem", "callbackPhone"]
}
```

### 3d. Enable call recording
In the assistant settings, turn on **Record calls** → Vapi will include `recordingUrl` in the webhook.

### 3e. Get a phone number
In Vapi dashboard: **Phone Numbers > Buy Number** → pick a Texas area code.
This is the number you'll put on your website.

---

## Step 4 — Connect Vapi to Your Script (5 min)

1. In Vapi dashboard, go to **Account > Webhooks** (or the assistant's **Advanced > Server URL**)
2. Set the **Server URL** to your Google Apps Script Web App URL from Step 2
3. Under **Custom Headers**, add:
   - Key: `x-webhook-secret`
   - Value: the same string you used for `VAPI_SECRET` in Script Properties
4. Make sure **end-of-call-report** event is checked

---

## Step 5 — Put the Vapi Number on Your Site

Add the Vapi phone number to the homeowner-facing parts of the site:
- Homepage hero section or CTA button
- Homeowner form success/confirmation screen
- Any "contact us" section

---

## Step 6 — Test Everything

### Test contractor signup SMS:
1. Open `contractor-form.html` in a browser, fill it with your own phone number
2. Submit → you should get a welcome text and an admin alert

### Test the AI call flow:
1. Call your Vapi number
2. Have a natural conversation — give a fake name, pick a city, describe a problem
3. End the call
4. Within 30 seconds, any contractor in that city's service area should get an SMS with your info and the recording link
5. Check the "AI Calls" tab in Google Sheets — the call should be logged

---

## Google Sheets Tabs Created Automatically

| Tab | Contents |
|---|---|
| Contractors | Every contractor signup |
| Homeowners | Homeowners who submitted the web form |
| AI Calls | Every Vapi call — name, city, problem, recording URL, contractors notified |
| Trials | Every contractor trial signup from the private trial form |

### Trials Tab

The private trial form (`contractor-trial.html`) writes a row to the **Trials** tab on each submission. Columns:

`Client ID · Status · Start Date · End Date · Business Name · First · Last · Phone · Email · Website · Service Area · Job Types · Lead Delivery · Notes · Signed · Submitted At`

- **Client ID** is auto-generated and sequential per year, e.g. `HFS-2026-0001`, `HFS-2026-0002`…
- **Start Date** is the submission date; **End Date** is 14 days later.
- To change the trial length, edit `TRIAL_LENGTH_DAYS` near the top of the trial section in `contractor-automation.gs`.
- You also get an admin SMS on each trial signup with the new Client ID and trial dates.

> **Important:** After updating `contractor-automation.gs` in the Apps Script editor, you must **re-deploy** (Deploy → Manage deployments → Edit → New version) for the Trials handler to go live.

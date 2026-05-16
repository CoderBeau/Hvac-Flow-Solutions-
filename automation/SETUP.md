# Contractor Signup Automation — Setup Guide

## How It Works

**On contractor signup:**
- Contractor fills out the form → they get a welcome text instantly
- You get an admin alert with their name, company, package, and areas

**When a homeowner calls the business number:**
1. Homeowner hears a menu and presses their city (San Antonio, Houston, Dallas, etc.)
2. They record their HVAC problem description (up to 2 minutes)
3. Every contractor signed up for that city receives an SMS with:
   - A link to the recording
   - The homeowner's call-back number
4. You also receive the same alert as admin
5. The voicemail is logged to a Google Sheet tab ("Voicemails")

---

## Step 1 — Twilio Account (5 min)

1. Sign up at **twilio.com** (free trial gives ~$15 credit)
2. Go to **Phone Numbers > Manage > Buy a number** — buy a Texas number (~$1/month)
3. Note down:
   - Account SID (on the Console dashboard)
   - Auth Token (click "show" on the dashboard)
   - Your new Twilio phone number (e.g. +12105551234)

---

## Step 2 — Google Apps Script (10 min)

1. Open the Google Sheet that receives form submissions
2. Click **Extensions > Apps Script**
3. Delete any existing code and paste the entire contents of `contractor-automation.gs`
4. Click the **gear icon** (Project Settings) and scroll to **Script Properties**. Add all 6:

| Property | Value |
|---|---|
| `TWILIO_SID` | Your Twilio Account SID |
| `TWILIO_TOKEN` | Your Twilio Auth Token |
| `TWILIO_FROM` | Your Twilio number, e.g. `+12105551234` |
| `ADMIN_PHONE` | Your cell, e.g. `+12105559999` |
| `SHEET_ID` | The long ID from your Google Sheet URL |
| `THIS_URL` | Leave blank for now — fill in after deploying |

5. Click **Deploy > New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy** and copy the Web App URL
7. Go back to Script Properties, set `THIS_URL` to that URL
8. Click **Deploy > Manage Deployments > Edit** (pencil icon) and re-deploy (new version) so the URL is baked in

---

## Step 3 — Wire Twilio to the Script (5 min)

1. In Twilio Console, go to **Phone Numbers > Manage > Active Numbers**
2. Click your number
3. Under **Voice Configuration**:
   - "A call comes in" → **Webhook** → paste your Apps Script Web App URL
   - HTTP method: **GET**
4. Save

---

## Step 4 — Put the Twilio Number on Your Site

Edit the homeowner-facing pages to display the Twilio business number so homeowners know to call it. Good spots:
- The homeowner form confirmation/success screen
- The homepage hero or "contact" section

---

## Step 5 — Test It

### Test SMS on contractor signup:
1. Open `contractor-form.html` in a browser
2. Fill in the form using **your own phone number**
3. Submit — verify:
   - Welcome text arrives at the contractor number
   - Admin alert arrives at your ADMIN_PHONE

### Test homeowner call flow:
1. Call your Twilio number from any phone
2. Press **1** (San Antonio) when prompted
3. After the beep, record a test message
4. Hang up — verify:
   - Any contractor in the sheet with "San Antonio" in their service areas gets an SMS with the recording link
   - Admin gets an alert SMS

### Check the Sheet:
- "Contractors" tab → signup rows appear
- "Voicemails" tab → each call is logged with city, caller, duration, contractor count, and recording URL

---

## Monthly Costs (Estimate)

| Item | Cost |
|---|---|
| Twilio phone number | ~$1/month |
| SMS (per message) | ~$0.0075 |
| Voice recording (per minute) | ~$0.005 |
| 10 signups + 30 homeowner calls/month | ~$5–8/month |

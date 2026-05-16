# Contractor Signup Automation — Setup Guide

## What This Does
- Texts the contractor a welcome message the moment they sign up
- Texts you (admin) a new-signup alert with their details
- Routes contractor→homeowner calls through a recorded business line
- Sends the homeowner an SMS with a link to the call recording after the call ends
- Logs every call recording to a Google Sheet tab

---

## Step 1 — Twilio Account (5 min)

1. Sign up at **twilio.com** (free trial gives you ~$15 credit)
2. Go to **Phone Numbers > Manage > Buy a number** — buy a Texas number (~$1/month)
3. Note down:
   - Account SID (on the Console dashboard)
   - Auth Token (on the Console dashboard, click "show")
   - Your new Twilio phone number (e.g. +12105551234)

---

## Step 2 — Google Apps Script (10 min)

1. Open your Google Sheet that receives form submissions
2. Click **Extensions > Apps Script**
3. Delete any existing code in the editor
4. Paste the entire contents of `contractor-automation.gs` (this folder)
5. Click **Project Settings** (gear icon on the left)
6. Scroll to **Script Properties** and add these 6 properties:

| Property | Value |
|---|---|
| `TWILIO_SID` | Your Twilio Account SID |
| `TWILIO_TOKEN` | Your Twilio Auth Token |
| `TWILIO_FROM` | Your Twilio number, e.g. `+12105551234` |
| `ADMIN_PHONE` | Your cell phone, e.g. `+12105559999` |
| `SHEET_ID` | The long ID from your Google Sheet URL |
| `THIS_URL` | Leave blank for now — fill in after Step 3 |

7. Click **Deploy > New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Click **Deploy**, copy the Web App URL
9. Go back to Script Properties, set `THIS_URL` to that URL
10. Click **Deploy > Manage Deployments**, then re-deploy to pick up the URL change

---

## Step 3 — Wire Twilio to the Script (5 min)

1. In Twilio Console, go to **Phone Numbers > Manage > Active Numbers**
2. Click your number
3. Under **Voice Configuration**:
   - "A call comes in": **Webhook** → paste your Apps Script Web App URL (the GET handler)
   - HTTP method: **GET**
4. Save

---

## Step 4 — Test It

### Test SMS on signup:
1. Open `contractor-form.html` in a browser
2. Fill out the form with **your own phone number**
3. Submit — you should receive:
   - A welcome text to the contractor number you entered
   - An admin alert to your ADMIN_PHONE

### Test call recording:
1. Call your Twilio business number from any phone
2. When prompted, enter a 10-digit number (e.g. your own cell)
3. The call connects — after you hang up, the dialed number gets an SMS with the recording link

### Check the Sheet:
- A "Contractors" tab should have the signup row
- A "Call Recordings" tab should have the call logged

---

## Step 5 — Give Contractors the Business Number

After setup, update the success screen on both forms to include your Twilio number:
- Edit `contractor-form.html` line ~495 and `index.html` line ~350
- Replace the generic step 4 text with: "Call your leads through **[YOUR TWILIO NUMBER]**"

---

## Monthly Costs (Estimate)

| Item | Cost |
|---|---|
| Twilio phone number | ~$1/month |
| SMS (per message) | ~$0.0075 |
| Call recording (per minute) | ~$0.005 |
| 10 signups + 50 calls/month | ~$5–10/month |

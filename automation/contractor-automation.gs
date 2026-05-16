// ============================================================
// HVAC Flow Solutions — Contractor Signup Automation
// Paste this into your Google Apps Script editor and deploy
// as a Web App (Execute as: Me, Access: Anyone).
//
// Required Script Properties (Project Settings > Script Properties):
//   TWILIO_SID    — Twilio Account SID
//   TWILIO_TOKEN  — Twilio Auth Token
//   TWILIO_FROM   — Your Twilio phone number, e.g. +12105551234
//   ADMIN_PHONE   — Owner's cell for new-signup alerts, e.g. +12105559999
//   SHEET_ID      — Google Sheets spreadsheet ID (from the URL)
//   THIS_URL      — This script's published Web App URL (for Twilio callbacks)
// ============================================================

// ── Entry Points ────────────────────────────────────────────

function doPost(e) {
  try {
    const action = e.parameter.action || '';

    // Twilio webhook: contractor dialed a homeowner number, connect + record
    if (action === 'connect') return handleConnect(e);

    // Twilio webhook: call ended, send recording to homeowner
    if (action === 'recording') return handleRecordingCallback(e);

    // Standard form submission from the website
    const data = JSON.parse(e.postData.contents);
    return handleFormSubmission(data);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// Called by Twilio when the business number receives a call
function doGet(e) {
  const thisUrl = getProperty('THIS_URL');
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Welcome to HVAC Flow Solutions. Enter the 10-digit homeowner phone number followed by pound.</Say>
  <Gather numDigits="10" action="${thisUrl}?action=connect" method="POST" timeout="15">
  </Gather>
  <Say>We did not receive input. Goodbye.</Say>
</Response>`;
  return ContentService.createTextOutput(twiml).setMimeType(ContentService.MimeType.XML);
}

// ── Form Submission Handler ──────────────────────────────────

function handleFormSubmission(data) {
  const ss    = SpreadsheetApp.openById(getProperty('SHEET_ID'));
  const sheet = getOrCreateSheet(ss, data.type === 'Contractor' ? 'Contractors' : 'Homeowners');

  if (data.type === 'Contractor') {
    appendContractorRow(sheet, data);
    notifyContractorSignup(data);
  } else if (data.type === 'Homeowner') {
    appendHomeownerRow(sheet, data);
  }

  return jsonResponse({ status: 'ok' });
}

function appendContractorRow(sheet, d) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Submitted At', 'First', 'Last', 'Company', 'Phone', 'Email', 'ZIP', 'Years', 'Service Areas', 'Package']);
  }
  sheet.appendRow([d.submittedAt, d.firstName, d.lastName, d.company, d.phone, d.email, d.zip, d.years, d.serviceAreas, d.package]);
}

function appendHomeownerRow(sheet, d) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Submitted At', 'First', 'Last', 'Phone', 'Email', 'ZIP', 'City', 'Service', 'Urgency']);
  }
  sheet.appendRow([d.submittedAt, d.firstName, d.lastName, d.phone, d.email, d.zip, d.city, d.service, d.urgency]);
}

function notifyContractorSignup(data) {
  // Welcome text to the contractor
  sendSMS(
    data.phone,
    `Welcome to HVAC Flow Solutions, ${data.firstName}! ` +
    `Your ${data.package} package is confirmed. We will start sending leads for ` +
    `${data.serviceAreas} shortly. Questions? Reply to this message.`
  );

  // Alert text to admin
  sendSMS(
    getProperty('ADMIN_PHONE'),
    `NEW CONTRACTOR SIGNUP\n` +
    `Name: ${data.firstName} ${data.lastName}\n` +
    `Company: ${data.company}\n` +
    `Package: ${data.package}\n` +
    `Phone: ${data.phone}\n` +
    `Areas: ${data.serviceAreas}`
  );
}

// ── Call Routing: Connect with Recording ────────────────────

function handleConnect(e) {
  const digits  = e.parameter.Digits || '';
  const thisUrl = getProperty('THIS_URL');

  if (!digits || digits.length !== 10) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Invalid number. Please try again.</Say>
</Response>`;
    return ContentService.createTextOutput(twiml).setMimeType(ContentService.MimeType.XML);
  }

  const homeownerNumber = '+1' + digits;
  const callbackUrl     = thisUrl + '?action=recording&homeowner=' + encodeURIComponent(homeownerNumber);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting your call now. This call will be recorded.</Say>
  <Dial record="record-from-answer"
        recordingStatusCallback="${callbackUrl}"
        recordingStatusCallbackMethod="POST"
        recordingStatusCallbackEvent="completed">
    <Number>${homeownerNumber}</Number>
  </Dial>
</Response>`;
  return ContentService.createTextOutput(twiml).setMimeType(ContentService.MimeType.XML);
}

// ── Recording Callback: Send Recording Link to Homeowner ────

function handleRecordingCallback(e) {
  const homeownerNumber = decodeURIComponent(e.parameter.homeowner || '');
  const recordingUrl    = e.parameter.RecordingUrl || '';
  const duration        = e.parameter.RecordingDuration || '0';

  if (!homeownerNumber || !recordingUrl) return jsonResponse({ status: 'skipped' });

  sendSMS(
    homeownerNumber,
    `Your HVAC contractor call has been recorded for your records (${duration}s). ` +
    `Listen here: ${recordingUrl}.mp3`
  );

  logRecording(homeownerNumber, recordingUrl, duration);
  return jsonResponse({ status: 'ok' });
}

function logRecording(homeownerNumber, recordingUrl, duration) {
  try {
    const ss    = SpreadsheetApp.openById(getProperty('SHEET_ID'));
    const sheet = getOrCreateSheet(ss, 'Call Recordings');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Homeowner Number', 'Duration (s)', 'Recording URL']);
    }
    sheet.appendRow([new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), homeownerNumber, duration, recordingUrl + '.mp3']);
  } catch (err) {
    // Non-fatal: SMS already sent
  }
}

// ── Twilio SMS Helper ────────────────────────────────────────

function sendSMS(to, body) {
  const sid   = getProperty('TWILIO_SID');
  const token = getProperty('TWILIO_TOKEN');
  const from  = getProperty('TWILIO_FROM');
  const url   = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  UrlFetchApp.fetch(url, {
    method:  'post',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
    payload: { To: to, From: from, Body: body },
    muteHttpExceptions: true
  });
}

// ── Utilities ────────────────────────────────────────────────

function getProperty(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

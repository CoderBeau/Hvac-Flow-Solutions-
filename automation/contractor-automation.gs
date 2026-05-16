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

    // Twilio: homeowner selected their city, now record their problem
    if (action === 'gather-city') return handleGatherCity(e);

    // Twilio: homeowner finished recording, send it to matched contractors
    if (action === 'voicemail-done') return handleVoicemailDone(e);

    // Standard form submission from the website
    const data = JSON.parse(e.postData.contents);
    return handleFormSubmission(data);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// ── Incoming Call: Homeowner Calls the Business Number ──────
// Twilio calls this (GET) when a homeowner dials the site's phone number.
// Ask them to pick their city so we can route to the right contractor(s).
function doGet(e) {
  const thisUrl = getProperty('THIS_URL');
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${thisUrl}?action=gather-city" method="POST" timeout="10">
    <Say voice="Polly.Joanna">
      Thank you for calling HVAC Flow Solutions. To connect you with the right contractor,
      please press the number for your city.
      Press 1 for San Antonio.
      Press 2 for Houston.
      Press 3 for Dallas.
      Press 4 for Austin.
      Press 5 for Fort Worth.
      Press 6 for El Paso.
    </Say>
  </Gather>
  <Say>We did not receive your selection. Please call back and try again. Goodbye.</Say>
</Response>`;
  return ContentService.createTextOutput(twiml).setMimeType(ContentService.MimeType.XML);
}

// ── Step 2: City selected — start recording the homeowner's problem ─

function handleGatherCity(e) {
  const digit   = e.parameter.Digits || '';
  const thisUrl = getProperty('THIS_URL');
  const city    = digitToCity(digit);

  if (!city) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Invalid selection. Please call back and try again.</Say>
</Response>`;
    return ContentService.createTextOutput(twiml).setMimeType(ContentService.MimeType.XML);
  }

  const callbackUrl = `${thisUrl}?action=voicemail-done&city=${encodeURIComponent(city)}&caller=${encodeURIComponent(e.parameter.Caller || '')}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">
    Great. After the beep, please describe your HVAC problem in detail — what is happening,
    how long it has been going on, and the best number to reach you.
    Press any key or stay silent for 3 seconds when you are finished.
  </Say>
  <Record maxLength="120" playBeep="true" action="${callbackUrl}" method="POST" timeout="3"/>
  <Say>We did not receive a recording. Please call back and try again.</Say>
</Response>`;
  return ContentService.createTextOutput(twiml).setMimeType(ContentService.MimeType.XML);
}

// ── Step 3: Recording done — send to matched contractors ────

function handleVoicemailDone(e) {
  const city         = decodeURIComponent(e.parameter.city    || '');
  const callerNumber = decodeURIComponent(e.parameter.caller  || e.parameter.Caller || '');
  const recordingUrl = e.parameter.RecordingUrl || '';
  const duration     = e.parameter.RecordingDuration || '0';

  if (!recordingUrl) return jsonResponse({ status: 'skipped' });

  const contractors = findContractorsByCity(city);
  const mp3Link     = recordingUrl + '.mp3';

  contractors.forEach(c => {
    sendSMS(
      c.phone,
      `NEW LEAD — ${city}\n` +
      `A homeowner just described their HVAC problem. Listen here:\n${mp3Link}\n` +
      `Call them back: ${callerNumber || 'number not captured'}`
    );
  });

  // Always alert admin too
  sendSMS(
    getProperty('ADMIN_PHONE'),
    `HOMEOWNER VOICEMAIL — ${city} (${duration}s)\n` +
    `Caller: ${callerNumber}\n` +
    `Recording: ${mp3Link}\n` +
    `Sent to ${contractors.length} contractor(s).`
  );

  logVoicemail(city, callerNumber, recordingUrl, duration, contractors.length);

  // Thank-you message back to caller
  return ContentService.createTextOutput(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">
    Thank you. Your message has been sent to an HVAC contractor in ${city}.
    You will receive a call back shortly. Goodbye.
  </Say>
</Response>`).setMimeType(ContentService.MimeType.XML);
}

// ── Contractor Matching ──────────────────────────────────────

function findContractorsByCity(city) {
  try {
    const ss    = SpreadsheetApp.openById(getProperty('SHEET_ID'));
    const sheet = ss.getSheetByName('Contractors');
    if (!sheet || sheet.getLastRow() < 2) return [];

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    // Column indexes (0-based): 0=submittedAt 1=first 2=last 3=company 4=phone 5=email 6=zip 7=years 8=serviceAreas 9=package
    return rows
      .filter(r => r[4] && r[8] && r[8].toString().toLowerCase().includes(city.toLowerCase()))
      .map(r => ({ firstName: r[1], lastName: r[2], company: r[3], phone: r[4] }));
  } catch (err) {
    return [];
  }
}

function digitToCity(digit) {
  const map = { '1': 'San Antonio', '2': 'Houston', '3': 'Dallas', '4': 'Austin', '5': 'Fort Worth', '6': 'El Paso' };
  return map[digit] || '';
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
  sendSMS(
    data.phone,
    `Welcome to HVAC Flow Solutions, ${data.firstName}! ` +
    `Your ${data.package} package is confirmed. When homeowners in ${data.serviceAreas} ` +
    `call our business line, you will receive their recorded message with a call-back number. Questions? Reply here.`
  );

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

// ── Logging ──────────────────────────────────────────────────

function logVoicemail(city, caller, recordingUrl, duration, contractorCount) {
  try {
    const ss    = SpreadsheetApp.openById(getProperty('SHEET_ID'));
    const sheet = getOrCreateSheet(ss, 'Voicemails');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'City', 'Caller', 'Duration (s)', 'Contractors Notified', 'Recording URL']);
    }
    sheet.appendRow([
      new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
      city, caller, duration, contractorCount, recordingUrl + '.mp3'
    ]);
  } catch (err) {
    // Non-fatal
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

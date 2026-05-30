// ============================================================
// HVAC Flow Solutions — Contractor Signup Automation
// Paste this into your Google Apps Script editor and deploy
// as a Web App (Execute as: Me, Access: Anyone).
//
// Required Script Properties (Project Settings > Script Properties):
//   TWILIO_SID    — Twilio Account SID (for SMS only)
//   TWILIO_TOKEN  — Twilio Auth Token
//   TWILIO_FROM   — Your Twilio phone number, e.g. +12105551234
//   ADMIN_PHONE   — Owner's cell for alerts, e.g. +12105559999
//   SHEET_ID      — Google Sheets spreadsheet ID (from the URL)
//   VAPI_SECRET   — Secret token you create; paste the same value in Vapi's
//                   webhook "Custom Header" as x-webhook-secret
// ============================================================

// ── Entry Points ────────────────────────────────────────────

function doPost(e) {
  try {
    const raw  = e.postData.contents;
    const data = JSON.parse(raw);

    // Vapi sends all events wrapped in a "message" object
    const msg = data.message || data;

    if (msg.type === 'end-of-call-report') {
      if (!verifyVapiSecret(e)) return jsonResponse({ status: 'unauthorized' });
      return handleVapiCall(msg);
    }

    // Website form submission
    return handleFormSubmission(data);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// ── Vapi End-of-Call Webhook ─────────────────────────────────
// Fires automatically when a homeowner call ends.
// Vapi passes the transcript, recording URL, and any structured
// data the AI collected during the conversation.

function handleVapiCall(msg) {
  const call     = msg.call || {};
  const analysis = msg.analysis || {};
  const gathered = analysis.structuredData || {};

  const callerNumber  = (call.customer || {}).number || '';
  const recordingUrl  = msg.recordingUrl || '';
  const transcript    = msg.transcript   || '';
  const summary       = analysis.summary || msg.summary || '';
  const duration      = msg.durationSeconds || 0;

  // Fields the Vapi AI assistant is configured to collect
  const callerName    = gathered.callerName    || 'Homeowner';
  const city          = gathered.city          || '';
  const problem       = gathered.problem       || 'See transcript';
  const callbackPhone = gathered.callbackPhone || callerNumber;
  const urgency       = gathered.urgency       || '';

  const contractors = city ? findContractorsByCity(city) : [];

  const urgencyLine = urgency ? `Urgency: ${urgency}\n` : '';

  contractors.forEach(c => {
    sendSMS(
      c.phone,
      `NEW LEAD${city ? ' — ' + city : ''}\n` +
      `Name: ${callerName}\n` +
      `Phone: ${callbackPhone}\n` +
      `${urgencyLine}` +
      `Issue: ${problem}\n` +
      (recordingUrl ? `Recording: ${recordingUrl}\n` : '') +
      `Reply STOP to opt out.`
    );
  });

  sendSMS(
    getProperty('ADMIN_PHONE'),
    `VAPI LEAD CALL${city ? ' — ' + city : ''} (${duration}s)\n` +
    `Caller: ${callerName} ${callerNumber}\n` +
    `Callback: ${callbackPhone}\n` +
    `${urgencyLine}` +
    `Issue: ${problem}\n` +
    (recordingUrl ? `Recording: ${recordingUrl}\n` : '') +
    `Sent to ${contractors.length} contractor(s).`
  );

  logVapiCall({ callerName, callerNumber, callbackPhone, city, problem, urgency, duration, recordingUrl, summary, contractorCount: contractors.length });

  return jsonResponse({ status: 'ok' });
}

function verifyVapiSecret(e) {
  const secret = getProperty('VAPI_SECRET');
  if (!secret) return true; // skip check if not configured yet
  const header = e.parameter['x-webhook-secret'] || '';
  return header === secret;
}

// ── Contractor Matching ──────────────────────────────────────

function findContractorsByCity(city) {
  try {
    const ss    = SpreadsheetApp.openById(getProperty('SHEET_ID'));
    const sheet = ss.getSheetByName('Contractors');
    if (!sheet || sheet.getLastRow() < 2) return [];

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    // Columns (0-based): 0=submittedAt 1=first 2=last 3=company 4=phone 5=email 6=zip 7=years 8=serviceAreas 9=package
    return rows
      .filter(r => r[4] && r[8] && r[8].toString().toLowerCase().includes(city.toLowerCase()))
      .map(r => ({ firstName: r[1], lastName: r[2], company: r[3], phone: r[4] }));
  } catch (err) {
    return [];
  }
}

// ── Form Submission Handler ──────────────────────────────────

function handleFormSubmission(data) {
  const ss = SpreadsheetApp.openById(getProperty('SHEET_ID'));

  if (data.type === 'Trial') {
    const result = appendTrialRow(ss, data);
    notifyTrialSignup(data, result.clientId, result.startDate, result.endDate);
    return jsonResponse({ status: 'ok', clientId: result.clientId, startDate: result.startDate, endDate: result.endDate });
  }

  const sheet = getOrCreateSheet(ss, data.type === 'Contractor' ? 'Contractors' : 'Homeowners');

  if (data.type === 'Contractor') {
    appendContractorRow(sheet, data);
    notifyContractorSignup(data);
  } else if (data.type === 'Homeowner') {
    appendHomeownerRow(sheet, data);
  }

  return jsonResponse({ status: 'ok' });
}

// ── Trial Signups ────────────────────────────────────────────
// Each trial gets an auto-generated Client ID, a start date, and
// an end date 14 days later. A lock prevents duplicate IDs when
// two contractors submit at the same moment.

var TRIAL_LENGTH_DAYS = 14;

function appendTrialRow(ss, d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getOrCreateSheet(ss, 'Trials');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Client ID', 'Status', 'Start Date', 'End Date',
        'Business Name', 'First', 'Last', 'Phone', 'Email', 'Website',
        'Service Area', 'Job Types', 'Lead Delivery', 'Notes',
        'Signed', 'Submitted At'
      ]);
      sheet.getRange(1, 1, 1, 16).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    const tz       = 'America/Chicago';
    const now      = new Date();
    const end      = new Date(now.getTime() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000);
    const fmt      = dt => Utilities.formatDate(dt, tz, 'MM/dd/yyyy');
    const clientId = generateClientId(sheet);

    sheet.appendRow([
      clientId,
      'Active',
      fmt(now),
      fmt(end),
      d.bizname  || '',
      d.firstName|| '',
      d.lastName || '',
      d.phone    || '',
      d.email    || '',
      d.website  || '',
      d.cities   || '',
      d.jobTypes || '',
      d.leadDelivery || '',
      d.notes    || '',
      d.signed ? 'Yes' : 'No',
      d.submittedAt || now.toLocaleString('en-US', { timeZone: tz })
    ]);

    return { clientId: clientId, startDate: fmt(now), endDate: fmt(end) };
  } finally {
    lock.releaseLock();
  }
}

// Sequential, readable IDs like HFS-2026-0001 that reset each year.
function generateClientId(sheet) {
  const year = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy');
  let maxNum = 0;
  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach(function (row) {
      const m = String(row[0]).match(new RegExp('^HFS-' + year + '-(\\d+)$'));
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
  }
  const next = ('0000' + (maxNum + 1)).slice(-4);
  return 'HFS-' + year + '-' + next;
}

function notifyTrialSignup(d, clientId, startDate, endDate) {
  sendSMS(
    getProperty('ADMIN_PHONE'),
    `NEW TRIAL SIGNUP\n` +
    `ID: ${clientId}\n` +
    `Business: ${d.bizname}\n` +
    `Name: ${d.firstName} ${d.lastName}\n` +
    `Phone: ${d.phone}\n` +
    `Area: ${d.cities}\n` +
    `Trial: ${startDate} → ${endDate}`
  );
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
    `call our AI line, you will receive their name, number, issue, and a recording instantly. Questions? Reply here.`
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

function logVapiCall(d) {
  try {
    const ss    = SpreadsheetApp.openById(getProperty('SHEET_ID'));
    const sheet = getOrCreateSheet(ss, 'AI Calls');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Caller Name', 'Caller #', 'Callback #', 'City', 'Urgency', 'Duration (s)', 'Contractors Notified', 'Problem', 'Recording URL', 'Summary']);
    }
    sheet.appendRow([
      new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
      d.callerName, d.callerNumber, d.callbackPhone, d.city, d.urgency,
      d.duration, d.contractorCount, d.problem, d.recordingUrl, d.summary
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

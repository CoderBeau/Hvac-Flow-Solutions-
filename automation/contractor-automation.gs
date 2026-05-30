// ============================================================
// HVAC Flow Solutions — Unified Automation Script
// Paste this into your Google Apps Script editor and deploy
// as a Web App (Execute as: Me, Access: Anyone).
//
// Script Properties (Project Settings > Script Properties):
//   SHEET_ID      — Google Sheets ID (from your sheet URL)
//   ADMIN_EMAIL   — Your email for all lead/signup notifications
//   TWILIO_SID    — Twilio Account SID (used only for Vapi contractor SMS)
//   TWILIO_TOKEN  — Twilio Auth Token
//   TWILIO_FROM   — Your Twilio number, e.g. +12105551234
//   VAPI_SECRET   — Secret token matching Vapi webhook custom header
// ============================================================

var TRIAL_LENGTH_DAYS = 14;

// ── Entry Point ──────────────────────────────────────────────

function doPost(e) {
  try {
    const raw  = e.postData.contents;
    const data = JSON.parse(raw);
    const msg  = data.message || data;

    if (msg.type === 'end-of-call-report') {
      if (!verifyVapiSecret(e)) return jsonResponse({ status: 'unauthorized' });
      return handleVapiCall(msg);
    }

    return handleFormSubmission(data);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// ── Form Submission Router ───────────────────────────────────

function handleFormSubmission(data) {
  const ss = SpreadsheetApp.openById(getProperty('SHEET_ID'));

  if (data.type === 'Trial') {
    const result = appendTrialRow(ss, data);
    emailTrialSignup(data, result.clientId, result.startDate, result.endDate);
    return jsonResponse({ status: 'ok', clientId: result.clientId, startDate: result.startDate, endDate: result.endDate });
  }

  if (data.type === 'Contractor') {
    const sheet = getOrCreateSheet(ss, 'Contractors');
    appendContractorRow(sheet, data);
    emailContractorSignup(data);
    return jsonResponse({ status: 'ok' });
  }

  if (data.type === 'Homeowner') {
    const sheet = getOrCreateSheet(ss, 'Homeowners');
    appendHomeownerRow(sheet, data);
    emailHomeownerLead(data);
    return jsonResponse({ status: 'ok' });
  }

  return jsonResponse({ status: 'ok' });
}

// ── Contractor Signup ────────────────────────────────────────

function appendContractorRow(sheet, d) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Submitted At', 'First', 'Last', 'Company', 'Phone', 'Email', 'ZIP', 'Years', 'Service Areas', 'Package']);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([d.submittedAt, d.firstName, d.lastName, d.company, d.phone, d.email, d.zip, d.years, d.serviceAreas, d.package]);
}

function emailContractorSignup(d) {
  MailApp.sendEmail({
    to: getProperty('ADMIN_EMAIL'),
    subject: 'New Contractor Signup — ' + d.firstName + ' ' + d.lastName,
    body:
      'NEW CONTRACTOR SIGNUP\n\n' +
      'Name: '              + (d.firstName    || '') + ' ' + (d.lastName || '') + '\n' +
      'Company: '           + (d.company      || '') + '\n' +
      'Package: '           + (d.package      || '') + '\n' +
      'Phone: '             + (d.phone        || '') + '\n' +
      'Email: '             + (d.email        || '') + '\n' +
      'Service Areas: '     + (d.serviceAreas || '') + '\n' +
      'ZIP: '               + (d.zip          || '') + '\n' +
      'Years in Business: ' + (d.years        || '') + '\n' +
      'Submitted: '         + (d.submittedAt  || '')
  });
}

// ── Homeowner Lead ───────────────────────────────────────────

function appendHomeownerRow(sheet, d) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Submitted At', 'First', 'Last', 'Phone', 'Email', 'ZIP', 'City', 'Service', 'Urgency']);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([d.submittedAt, d.firstName, d.lastName, d.phone, d.email, d.zip, d.city, d.service, d.urgency]);
}

function emailHomeownerLead(d) {
  MailApp.sendEmail({
    to: getProperty('ADMIN_EMAIL'),
    subject: 'New Homeowner Lead — ' + (d.firstName || '') + ' ' + (d.lastName || '') + (d.city ? ' (' + d.city + ')' : ''),
    body:
      'NEW HOMEOWNER LEAD\n\n' +
      'Name: '           + (d.firstName || '') + ' ' + (d.lastName || '') + '\n' +
      'Phone: '          + (d.phone     || '') + '\n' +
      'Email: '          + (d.email     || '') + '\n' +
      'City: '           + (d.city      || '') + '\n' +
      'ZIP: '            + (d.zip       || '') + '\n' +
      'Service Needed: ' + (d.service   || '') + '\n' +
      'Urgency: '        + (d.urgency   || '') + '\n' +
      'Submitted: '      + (d.submittedAt || '')
  });
}

// ── Trial Signup ─────────────────────────────────────────────

function appendTrialRow(ss, d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getOrCreateSheet(ss, 'Trials');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Client ID', 'Status', 'Start Date', 'End Date',
        'Business Name', 'First', 'Last', 'Phone', 'Email', 'Website',
        'Service Area', 'Job Types', 'Lead Delivery', 'Notes', 'Signed', 'Submitted At'
      ]);
      sheet.getRange(1, 1, 1, 16).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    const tz       = 'America/Chicago';
    const now      = new Date();
    const end      = new Date(now.getTime() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000);
    const fmt      = function(dt) { return Utilities.formatDate(dt, tz, 'MM/dd/yyyy'); };
    const clientId = generateClientId(sheet);

    sheet.appendRow([
      clientId, 'Active', fmt(now), fmt(end),
      d.bizname      || '',
      d.firstName    || '',
      d.lastName     || '',
      d.phone        || '',
      d.email        || '',
      d.website      || '',
      d.cities       || '',
      d.jobTypes     || '',
      d.leadDelivery || '',
      d.notes        || '',
      d.signed ? 'Yes' : 'No',
      d.submittedAt  || now.toLocaleString('en-US', { timeZone: tz })
    ]);

    return { clientId: clientId, startDate: fmt(now), endDate: fmt(end) };
  } finally {
    lock.releaseLock();
  }
}

function generateClientId(sheet) {
  const year = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy');
  var maxNum = 0;
  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach(function(row) {
      const m = String(row[0]).match(new RegExp('^HFS-' + year + '-(\\d+)$'));
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
  }
  return 'HFS-' + year + '-' + ('0000' + (maxNum + 1)).slice(-4);
}

function emailTrialSignup(d, clientId, startDate, endDate) {
  MailApp.sendEmail({
    to: getProperty('ADMIN_EMAIL'),
    subject: 'New Trial Signup — ' + (d.bizname || d.firstName) + ' [' + clientId + ']',
    body:
      'NEW CONTRACTOR TRIAL SIGNUP\n\n' +
      'Client ID: '        + clientId  + '\n' +
      'Trial Period: '     + startDate + ' → ' + endDate + '\n\n' +
      'Business: '         + (d.bizname      || '') + '\n' +
      'Name: '             + (d.firstName    || '') + ' ' + (d.lastName || '') + '\n' +
      'Phone: '            + (d.phone        || '') + '\n' +
      'Email: '            + (d.email        || '') + '\n' +
      'Website: '          + (d.website      || 'N/A') + '\n' +
      'Service Area: '     + (d.cities       || '') + '\n' +
      'Job Types: '        + (d.jobTypes     || '') + '\n' +
      'Lead Delivery: '    + (d.leadDelivery || '') + '\n' +
      'Signed Agreement: ' + (d.signed ? 'Yes' : 'No') + '\n' +
      'Notes: '            + (d.notes        || 'None') + '\n' +
      'Submitted: '        + (d.submittedAt  || '')
  });
}

// ── Vapi End-of-Call Webhook ─────────────────────────────────
// Fires when a homeowner call ends. Texts matched contractors
// via Twilio and emails you a summary.

function handleVapiCall(msg) {
  const call     = msg.call     || {};
  const analysis = msg.analysis || {};
  const gathered = analysis.structuredData || {};

  const callerNumber  = (call.customer || {}).number || '';
  const recordingUrl  = msg.recordingUrl || '';
  const summary       = analysis.summary || msg.summary || '';
  const duration      = msg.durationSeconds || 0;

  const callerName    = gathered.callerName    || 'Homeowner';
  const city          = gathered.city          || '';
  const problem       = gathered.problem       || 'See transcript';
  const callbackPhone = gathered.callbackPhone || callerNumber;
  const urgency       = gathered.urgency       || '';

  const contractors = city ? findContractorsByCity(city) : [];
  const urgencyLine = urgency ? 'Urgency: ' + urgency + '\n' : '';

  contractors.forEach(function(c) {
    sendSMS(
      c.phone,
      'NEW LEAD' + (city ? ' — ' + city : '') + '\n' +
      'Name: '  + callerName    + '\n' +
      'Phone: ' + callbackPhone + '\n' +
      urgencyLine +
      'Issue: ' + problem + '\n' +
      (recordingUrl ? 'Recording: ' + recordingUrl + '\n' : '') +
      'Reply STOP to opt out.'
    );
  });

  MailApp.sendEmail({
    to: getProperty('ADMIN_EMAIL'),
    subject: 'Vapi Lead Call — ' + callerName + (city ? ' (' + city + ')' : ''),
    body:
      'VAPI AI LEAD CALL\n\n' +
      'Caller: '               + callerName    + ' ' + callerNumber + '\n' +
      'Callback: '             + callbackPhone + '\n' +
      'City: '                 + city          + '\n' +
      urgencyLine +
      'Issue: '                + problem       + '\n' +
      'Duration: '             + duration      + 's\n' +
      (recordingUrl ? 'Recording: ' + recordingUrl + '\n' : '') +
      'Contractors Notified: ' + contractors.length + '\n\n' +
      'Summary: '              + summary
  });

  logVapiCall({
    callerName: callerName, callerNumber: callerNumber, callbackPhone: callbackPhone,
    city: city, problem: problem, urgency: urgency, duration: duration,
    recordingUrl: recordingUrl, summary: summary, contractorCount: contractors.length
  });

  return jsonResponse({ status: 'ok' });
}

function verifyVapiSecret(e) {
  const secret = getProperty('VAPI_SECRET');
  if (!secret) return true;
  const header = e.parameter['x-webhook-secret'] || '';
  return header === secret;
}

// ── Contractor Matching (for Vapi) ───────────────────────────

function findContractorsByCity(city) {
  try {
    const ss    = SpreadsheetApp.openById(getProperty('SHEET_ID'));
    const sheet = ss.getSheetByName('Contractors');
    if (!sheet || sheet.getLastRow() < 2) return [];
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    return rows
      .filter(function(r) { return r[4] && r[8] && r[8].toString().toLowerCase().includes(city.toLowerCase()); })
      .map(function(r)    { return { firstName: r[1], lastName: r[2], company: r[3], phone: r[4] }; });
  } catch (err) {
    return [];
  }
}

// ── Vapi Call Logger ─────────────────────────────────────────

function logVapiCall(d) {
  try {
    const ss    = SpreadsheetApp.openById(getProperty('SHEET_ID'));
    const sheet = getOrCreateSheet(ss, 'AI Calls');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Caller Name', 'Caller #', 'Callback #', 'City', 'Urgency', 'Duration (s)', 'Contractors Notified', 'Problem', 'Recording URL', 'Summary']);
      sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
      d.callerName, d.callerNumber, d.callbackPhone, d.city, d.urgency,
      d.duration, d.contractorCount, d.problem, d.recordingUrl, d.summary
    ]);
  } catch (err) {
    // non-fatal
  }
}

// ── Twilio SMS (Vapi contractor alerts only) ─────────────────

function sendSMS(to, body) {
  const sid   = getProperty('TWILIO_SID');
  const token = getProperty('TWILIO_TOKEN');
  const from  = getProperty('TWILIO_FROM');
  const url   = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json';
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

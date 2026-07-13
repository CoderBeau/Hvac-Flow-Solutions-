// ============================================================
// HVAC Flow Solutions — Complete Automation Script
// Paste this ENTIRE file into your Google Apps Script editor,
// then Deploy > Manage deployments > Edit > New version > Deploy.
//
// Handles:
//   • Get Quotes (homeowner) leads  -> "Get Quotes" tab + email + instant SMS + 24h follow-up SMS
//   • Contractor signups            -> "Contractors" tab + email + PayPal link + welcome SMS
//   • Contractor trial signups      -> "Trials" tab + "Contractors" tab (Trial row) + email + SMS
//   • Lead routing                  -> Round-robin to San Antonio contractors, by email + SMS
//   • Lead caps                     -> Hard stop once a one-time pack hits its lead limit
//   • Monthly memberships           -> Recurring tiers whose lead quota resets each billing cycle
//   • Trial expiration              -> Auto-pauses leads 14 days after trial start
//   • Manual control                -> "HVAC Admin" menu in the sheet to pause/resume any contractor
//
// Required Script Properties (Project Settings > Script Properties):
//   TWILIO_SID    — Twilio Account SID (SMS is skipped silently until this is set)
//   TWILIO_TOKEN  — Twilio Auth Token
//   TWILIO_FROM   — Your Twilio phone number, e.g. +12105551234
//   ADMIN_PHONE   — Owner's cell for alerts, e.g. +12105559999
// ============================================================

var TRIAL_LENGTH_DAYS = 14;
var ADMIN_EMAIL = 'hvacflowsolutions@gmail.com';
var HOMEOWNER_FOLLOWUP_HOURS = 24;

// Active city for lead routing. Change this when you expand to a new city.
var ACTIVE_CITY = 'San Antonio';

// Lead limit per paid package. Once a contractor's "Leads Sent" count
// reaches this number, routing automatically stops for them.
var PACKAGE_LEAD_CAPS = {
  'Tester':      5,
  'Starter':     10,
  'Growth':      25,
  'Pro Partner': 50,
  'Elite':       100
};

// Monthly membership tiers. Unlike one-time packs (which stop permanently
// once the cap is hit), a membership's "Leads Sent" resets to 0 each billing
// cycle so the contractor gets their full monthly quota again.
// Package names must contain these exact strings, e.g. "Growth Membership".
var MEMBERSHIP_LEAD_CAPS = {
  'Starter Membership': 15,
  'Growth Membership':  30,
  'Pro Membership':     9999   // effectively unlimited (40+ / mo)
};

// ── Entry Point ──────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.type === 'Homeowner') {
      writeHomeowner(ss, data);
      sendEmailAlert('Homeowner', data);
      notifyHomeownerInstantSMS(data);
      forwardLeadToContractor(data);
    } else if (data.type === 'Contractor') {
      writeContractor(ss, data);
      sendEmailAlert('Contractor', data);
      sendContractorPaymentLink(data);
      notifyContractorSignupSMS(data);
    } else if (data.type === 'Trial') {
      const result = appendTrialRow(ss, data);
      emailTrialSignup(data, result.clientId, result.startDate, result.endDate);
      notifyTrialSignupSMS(data, result.clientId, result.startDate, result.endDate);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Get Quotes (Homeowner) writer ────────────────────────────
function writeHomeowner(ss, data) {
  let sheet = ss.getSheetByName('Get Quotes');
  if (!sheet) sheet = ss.insertSheet('Get Quotes');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Timestamp', 'First Name', 'Last Name', 'Phone', 'Email',
      'ZIP', 'City', 'Service Needed', 'Urgency', 'Source', 'Campaign', 'Notes', 'Follow-up Sent'
    ]);
    const headerRange = sheet.getRange(1, 1, 1, 13);
    headerRange.setBackground('#0B1E3B');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    [160, 100, 100, 130, 200, 70, 120, 180, 140, 130, 160, 280, 130]
      .forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  }

  sheet.appendRow([
    data.submittedAt || new Date().toLocaleString(),
    data.firstName   || '',
    data.lastName    || '',
    data.phone       || '',
    data.email       || '',
    data.zip         || '',
    data.city        || '',
    data.service     || '',
    data.urgency     || '',
    data.source      || 'Organic / Direct',
    data.campaign    || '',
    data.notes       || data.description || '',
    ''  // Follow-up Sent — filled in by sendHomeownerFollowUps()
  ]);
}

// ── Contractor writer ────────────────────────────────────────
// Columns: Timestamp | First | Last | Company | Phone | Email | ZIP |
//          Years | Service Areas | Package | Status | Leads Sent |
//          Lead Cap | Trial End Date | Client ID
function ensureContractorsHeaders(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow([
    'Timestamp', 'First Name', 'Last Name', 'Company', 'Phone',
    'Email', 'ZIP', 'Years in Business', 'Service Areas', 'Package Selected',
    'Status', 'Leads Sent', 'Lead Cap', 'Trial End Date', 'Client ID', 'Renews On'
  ]);
  const headerRange = sheet.getRange(1, 1, 1, 16);
  headerRange.setBackground('#0B1E3B');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
  [160, 100, 100, 200, 130, 200, 70, 130, 220, 140, 100, 90, 80, 120, 110, 120]
    .forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

function writeContractor(ss, data) {
  let sheet = ss.getSheetByName('Contractors');
  if (!sheet) sheet = ss.insertSheet('Contractors');
  ensureContractorsHeaders(sheet);

  var renewsOn = isMembership(data.package) ? addOneMonth(new Date()) : '';
  sheet.appendRow([
    data.submittedAt  || new Date().toLocaleString(),
    data.firstName    || '',
    data.lastName     || '',
    data.company      || '',
    data.phone        || '',
    data.email        || '',
    data.zip          || '',
    data.years        || '',
    data.serviceAreas || '',
    data.package      || '',
    'Active',
    0,
    packageToLeadCap(data.package),
    '',  // Trial End Date — not a trial signup
    '',  // Client ID — not a trial signup
    renewsOn   // Renews On — membership billing anniversary (blank for one-time packs)
  ]);
}

function packageToLeadCap(pkg) {
  pkg = pkg || '';
  // Check membership tiers first (their names contain "Membership")
  for (var m in MEMBERSHIP_LEAD_CAPS) {
    if (pkg.indexOf(m) !== -1) return MEMBERSHIP_LEAD_CAPS[m];
  }
  for (var name in PACKAGE_LEAD_CAPS) {
    if (pkg.indexOf(name) !== -1) return PACKAGE_LEAD_CAPS[name];
  }
  return '';
}

// True if the package string is a recurring monthly membership tier.
function isMembership(pkg) {
  pkg = pkg || '';
  for (var m in MEMBERSHIP_LEAD_CAPS) {
    if (pkg.indexOf(m) !== -1) return true;
  }
  return false;
}

// Returns a new Date one calendar month after the given date.
function addOneMonth(date) {
  var d = new Date(date.getTime());
  d.setMonth(d.getMonth() + 1);
  return d;
}

// ── Email alerts (Homeowner + Contractor) ────────────────────
function sendEmailAlert(type, data) {
  let subject, body;

  if (type === 'Homeowner') {
    subject = '🔥 New Quote Request – ' + (data.service || '') + ' in ' + (data.city || data.zip || '');
    body =
      'New homeowner quote request just came in!\n\n' +
      'Name: '     + data.firstName + ' ' + data.lastName + '\n' +
      'Phone: '    + data.phone + '\n' +
      'Email: '    + data.email + '\n' +
      'ZIP: '      + data.zip + '\n' +
      'City: '     + (data.city || '') + '\n' +
      'Service: '  + data.service + '\n' +
      'Urgency: '  + data.urgency + '\n' +
      'Source: '   + (data.source   || 'Organic / Direct') + '\n' +
      'Campaign: ' + (data.campaign || 'N/A') + '\n' +
      'Notes: '    + (data.notes || data.description || 'N/A') + '\n' +
      'Submitted: '+ data.submittedAt;
  } else {
    subject = '⚡ New Contractor Application – ' + (data.company || '');
    body =
      'New contractor application just came in!\n\n' +
      'Name: '              + data.firstName + ' ' + data.lastName + '\n' +
      'Company: '           + data.company + '\n' +
      'Phone: '             + data.phone + '\n' +
      'Email: '             + data.email + '\n' +
      'ZIP: '               + data.zip + '\n' +
      'Years in Business: ' + data.years + '\n' +
      'Service Areas: '     + data.serviceAreas + '\n' +
      'Package: '           + data.package + '\n' +
      'Submitted: '         + data.submittedAt;
  }

  MailApp.sendEmail(ADMIN_EMAIL, subject, body);
}

// ── SMS: Homeowner instant confirmation + 24h follow-up ──────
function notifyHomeownerInstantSMS(data) {
  if (!data.phone) return;
  sendSMS(data.phone,
    'Thanks ' + (data.firstName || '') + '! HVAC Flow Solutions got your ' +
    (data.service || 'service') + ' request. A local licensed contractor will reach out shortly.'
  );
}

function sendHomeownerFollowUps() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Get Quotes');
  if (!sheet || sheet.getLastRow() < 2) return;

  var lastCol = Math.max(sheet.getLastColumn(), 13);
  var rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var cutoffMs = HOMEOWNER_FOLLOWUP_HOURS * 60 * 60 * 1000;
  var now = new Date();

  rows.forEach(function(row, i) {
    if (row[12]) return; // Follow-up Sent already set

    var submittedAt = parseTimestamp(row[0]);
    if (!submittedAt) return;

    if (now.getTime() - submittedAt.getTime() >= cutoffMs) {
      var phone     = row[3];
      var firstName = row[1];
      var service   = row[7];
      if (phone) {
        sendSMS(phone,
          'Hi ' + (firstName || '') + ', this is HVAC Flow Solutions checking in on your ' +
          (service || 'HVAC') + ' request. Did a contractor reach out yet? Reply and let us know if you still need help.'
        );
      }
      sheet.getRange(i + 2, 13).setValue(now);
    }
  });
}

function parseTimestamp(value) {
  if (value instanceof Date) return value;
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// ── SMS: Contractor signup welcome + admin alert ─────────────
function notifyContractorSignupSMS(data) {
  if (data.phone) {
    sendSMS(data.phone,
      'Welcome to HVAC Flow Solutions, ' + data.firstName + '! Your ' + data.package +
      ' application is received. Check your email for the payment link to activate lead delivery.'
    );
  }
  sendSMS(getProperty('ADMIN_PHONE'),
    'NEW CONTRACTOR SIGNUP: ' + data.firstName + ' ' + data.lastName + ' (' + data.company + ') - ' +
    data.package + ' - ' + data.phone
  );
}

// ── SMS: Trial signup welcome + admin alert ──────────────────
function notifyTrialSignupSMS(d, clientId, startDate, endDate) {
  if (d.phone) {
    sendSMS(d.phone,
      'Welcome to your HVAC Flow Solutions free trial, ' + (d.firstName || '') + '! Client ID ' + clientId +
      '. Your trial runs ' + startDate + ' to ' + endDate + '. Leads will start arriving shortly.'
    );
  }
  sendSMS(getProperty('ADMIN_PHONE'),
    'NEW TRIAL SIGNUP: ' + (d.bizname || d.firstName) + ' [' + clientId + '] trial ' + startDate + '–' + endDate
  );
}

// ── Lead routing — round-robin for ACTIVE_CITY ───────────────
function forwardLeadToContractor(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contractors');
  var contractor = pickContractor(sheet);
  if (!contractor) return;  // no active contractors under cap, skip

  var source = data.source || 'Website';
  var subject = 'New HVAC Lead – ' + (data.service || 'Service Request') +
                ' in ' + (data.city || data.zip || 'Texas');

  var body =
    'You have a new HVAC lead from HVAC Flow Solutions!\n\n' +
    'Name: '        + (data.firstName || '') + ' ' + (data.lastName || '') + '\n' +
    'Phone: '       + (data.phone     || '') + '\n' +
    'Email: '       + (data.email     || '') + '\n' +
    'ZIP: '         + (data.zip       || '') + '\n' +
    'City: '        + (data.city      || '') + '\n' +
    'Service: '     + (data.service   || '') + '\n' +
    'Urgency: '     + (data.urgency   || '') + '\n' +
    'Notes: '       + (data.notes || data.description || 'None') + '\n' +
    'Lead Source: ' + source + '\n\n' +
    'Call or text this homeowner as soon as possible to win the job.\n\n' +
    '- HVAC Flow Solutions';

  MailApp.sendEmail(contractor.email, subject, body);

  if (contractor.phone) {
    sendSMS(contractor.phone,
      'NEW LEAD – ' + (data.service || 'HVAC') + ' in ' + (data.city || data.zip || 'TX') + '\n' +
      'Name: '    + (data.firstName || '') + ' ' + (data.lastName || '') + '\n' +
      'Phone: '   + (data.phone || '') + '\n' +
      'Urgency: ' + (data.urgency || '') + '\n' +
      'Call them back ASAP to win the job.'
    );
  }

  incrementLeadCount(sheet, contractor.row);
  enforceLeadCap(sheet, contractor.row, contractor.leadCap);
}

// Picks the active contractor in ACTIVE_CITY with the fewest leads sent,
// skipping anyone over their package's lead cap. Ties go to whoever
// signed up first (top of the sheet). Blank Status counts as Active.
function pickContractor(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return null;

  var lastCol = Math.max(sheet.getLastColumn(), 15);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var city  = ACTIVE_CITY.toLowerCase();

  var candidates = [];
  rows.forEach(function(row, i) {
    var serviceAreas = String(row[8]).toLowerCase();   // col 9
    var phone        = String(row[4]).trim();          // col 5
    var email        = String(row[5]).trim();          // col 6
    var status       = String(row[10]).trim();         // col 11
    var leadsCount   = parseInt(row[11], 10) || 0;      // col 12
    var leadCapRaw   = row[12];                          // col 13
    var leadCap      = (leadCapRaw === '' || leadCapRaw === null || isNaN(parseInt(leadCapRaw, 10)))
      ? null : parseInt(leadCapRaw, 10);

    var isActive   = (status === 'Active' || status === '');
    var coversCity = (serviceAreas.indexOf(city) !== -1);
    var underCap   = (leadCap === null || leadsCount < leadCap);

    if (isActive && coversCity && email && underCap) {
      candidates.push({ row: i + 2, email: email, phone: phone, leadsCount: leadsCount, leadCap: leadCap });
    }
  });

  if (candidates.length === 0) return null;

  var minLeads = candidates.reduce(function(min, c) {
    return c.leadsCount < min ? c.leadsCount : min;
  }, Infinity);

  return candidates.filter(function(c) {
    return c.leadsCount === minLeads;
  })[0];
}

// Increments the Leads Sent counter in col 12 for the given sheet row.
function incrementLeadCount(sheet, rowIndex) {
  var cell = sheet.getRange(rowIndex, 12);
  cell.setValue((parseInt(cell.getValue(), 10) || 0) + 1);
}

// Hard stop: once Leads Sent reaches the package's cap, pause routing
// for that contractor and notify both the contractor and admin.
function enforceLeadCap(sheet, rowIndex, leadCap) {
  if (leadCap === null) return;

  var leadsSent = parseInt(sheet.getRange(rowIndex, 12).getValue(), 10) || 0;
  if (leadsSent < leadCap) return;

  sheet.getRange(rowIndex, 11).setValue('Limit Reached');

  var name  = sheet.getRange(rowIndex, 2).getValue();
  var phone = sheet.getRange(rowIndex, 5).getValue();
  var pkg   = sheet.getRange(rowIndex, 10).getValue();
  var member = isMembership(pkg);

  if (phone) {
    if (member) {
      var renews = parseTimestamp(sheet.getRange(rowIndex, 16).getValue());
      sendSMS(phone,
        'You have received all ' + leadCap + ' leads in your ' + pkg + ' this cycle. Your leads ' +
        'automatically refresh' + (renews ? ' on ' + renews.toLocaleDateString() : ' on your next billing date') + '.'
      );
    } else {
      sendSMS(phone,
        'You have used all ' + leadCap + ' leads in your ' + pkg + ' package. Lead delivery is paused ' +
        'until you renew or upgrade. Reply to this text or contact us to choose a new package.'
      );
    }
  }
  sendSMS(getProperty('ADMIN_PHONE'),
    'LEAD CAP REACHED: ' + name + ' (' + pkg + ') hit ' + leadCap + ' leads. Routing paused automatically. ' +
    (member ? 'Membership resets next billing cycle.' : 'Reach out about renewal or upgrade.')
  );
}

// ── Contractor payment link email ────────────────────────────
function sendContractorPaymentLink(data) {
  var pkg = data.package || '';

  var packageLinks = {
    'Tester':      'https://www.paypal.com/ncp/payment/9VHMU8UYMVXXC',
    'Starter':     'https://www.paypal.com/ncp/payment/Y55WAFWV7DTHW',
    'Growth':      'https://www.paypal.com/ncp/payment/W6TP29DWKKVNN',
    'Pro Partner': 'https://www.paypal.com/ncp/payment/JLB9BGEGV6VKJ',
    'Elite':       'https://www.paypal.com/ncp/payment/X57YNYLKM8W7Y'
  };
  var packageAmounts = {
    'Tester':      '$75',
    'Starter':     '$150',
    'Growth':      '$375',
    'Pro Partner': '$700',
    'Elite':       '$1,300'
  };

  var paypalLink = '', amount = '';
  for (var name in packageLinks) {
    if (pkg.indexOf(name) !== -1) {
      paypalLink = packageLinks[name];
      amount = packageAmounts[name];
      break;
    }
  }

  var subject = 'Your HVAC Flow Solutions Application - Complete Payment to Activate';
  var body = 'Hi ' + data.firstName + ',\n\n'
    + 'Thank you for applying to receive exclusive Texas HVAC leads through HVAC Flow Solutions!\n\n'
    + 'Your application has been received. To activate your account and start receiving leads, '
    + 'please complete your payment using the link below:\n\n'
    + 'Package: ' + pkg + '\n'
    + 'Amount Due: ' + amount + '\n\n'
    + 'Pay Now: ' + paypalLink + '\n\n'
    + 'Once payment is confirmed your leads will begin arriving within 3-7 business days.\n\n'
    + 'What happens next:\n'
    + '1. Click the payment link above\n'
    + '2. Complete payment via PayPal\n'
    + '3. Leads start flowing within 3-7 business days\n\n'
    + 'Questions? Reply to this email.\n\n'
    + '- HVAC Flow Solutions Team\n'
    + 'boosthvacleads.com';

  MailApp.sendEmail(data.email, subject, body);
}

// ── Trial Signup ─────────────────────────────────────────

function appendTrialRow(ss, d) {
  var sheet = ss.getSheetByName('Trials') || ss.insertSheet('Trials');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Client ID','Status','Start Date','End Date','Business Name','First','Last',
      'Phone','Email','Website','Service Area','Job Types','Lead Delivery','Notes','Signed','Submitted At']);
  }

  var clientId = generateTrialClientId(sheet);
  var start = new Date();
  var end = new Date(start.getTime() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000);

  var signatureUrl = '';
  if (d.signature) {
    signatureUrl = saveSignatureToDrive(d.signature, clientId);
  }

  sheet.appendRow([
    clientId,
    'Active',
    start.toLocaleDateString(),
    end.toLocaleDateString(),
    d.bizname   || '',
    d.firstName || '',
    d.lastName  || '',
    d.phone     || '',
    d.email     || '',
    d.website   || '',
    d.cities    || '',
    d.jobtypes  || '',
    d.leaddelivery || '',
    d.notes     || '',
    signatureUrl,
    new Date().toLocaleString()
  ]);

  addTrialToContractors(ss, d, clientId, end);

  return { clientId: clientId, startDate: start, endDate: end };
}

function addTrialToContractors(ss, d, clientId, endDate) {
  var sheet = ss.getSheetByName('Contractors') || ss.insertSheet('Contractors');
  ensureContractorsHeaders(sheet);
  sheet.appendRow([
    d.submittedAt || new Date().toLocaleString(),
    d.firstName || '',
    d.lastName  || '',
    d.bizname   || '',
    d.phone     || '',
    d.email     || '',
    '',
    '',
    d.cities    || '',
    'Trial',
    'Active',
    0,
    '',
    endDate,
    clientId,
    ''   // Renews On — trials are not monthly memberships
  ]);
}

function generateTrialClientId(sheet) {
  var year = new Date().getFullYear();
  var data = sheet.getDataRange().getValues();
  var maxSeq = 0;
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][0] || '');
    var match = id.match(/^HFS-(\d{4})-(\d{4})$/);
    if (match && parseInt(match[1], 10) === year) {
      var seq = parseInt(match[2], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  var next = maxSeq + 1;
  return 'HFS-' + year + '-' + ('0000' + next).slice(-4);
}

function saveSignatureToDrive(base64DataUrl, clientId) {
  try {
    var match = base64DataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return '';
    var contentType = match[1];
    var bytes = Utilities.base64Decode(match[2]);
    var blob = Utilities.newBlob(bytes, contentType, clientId + '-signature.png');
    var folder = DriveApp.getRootFolder();
    var folders = DriveApp.getFoldersByName('HVAC Trial Signatures');
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder('HVAC Trial Signatures');
    }
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (err) {
    return '';
  }
}

function emailTrialSignup(d, clientId, startDate, endDate) {
  var subject = 'Trial Activated: ' + clientId + ' - ' + (d.bizname || d.firstName);
  var body = 'New trial signup!\n\n'
    + 'Client ID: ' + clientId + '\n'
    + 'Business: ' + (d.bizname || '') + '\n'
    + 'Contact: ' + (d.firstName || '') + ' ' + (d.lastName || '') + '\n'
    + 'Phone: ' + (d.phone || '') + '\n'
    + 'Email: ' + (d.email || '') + '\n'
    + 'Service Areas: ' + (d.cities || '') + '\n'
    + 'Job Types: ' + (d.jobtypes || '') + '\n'
    + 'Lead Delivery: ' + (d.leaddelivery || '') + '\n'
    + 'Trial Start: ' + startDate.toLocaleDateString() + '\n'
    + 'Trial End: ' + endDate.toLocaleDateString() + '\n\n'
    + 'Notes: ' + (d.notes || '');

  MailApp.sendEmail(ADMIN_EMAIL, subject, body);

  var welcomeSubject = 'Your HVAC Flow Solutions Trial Is Active - ' + clientId;
  var welcomeBody = 'Hi ' + (d.firstName || '') + ',\n\n'
    + 'Your 14-day free trial is now active!\n\n'
    + 'Client ID: ' + clientId + '\n'
    + 'Trial Start: ' + startDate.toLocaleDateString() + '\n'
    + 'Trial End: ' + endDate.toLocaleDateString() + '\n\n'
    + 'Leads matching your service areas will start arriving shortly. After your 14 days, '
    + 'lead delivery pauses automatically unless you move to a monthly membership '
    + '(Starter, Growth, or Pro) to keep the exclusive leads coming every month.\n\n'
    + 'Questions? Reply to this email.\n\n'
    + '- HVAC Flow Solutions Team';

  if (d.email) {
    MailApp.sendEmail(d.email, welcomeSubject, welcomeBody);
  }
}

// ── Scheduled Maintenance ────────────────────────────────

function runDailyMaintenance() {
  checkTrialExpirations();
  resetMonthlyMemberships();
}

// Resets each monthly member's "Leads Sent" to 0 when their billing
// anniversary passes, reactivates them if they were paused for hitting
// the monthly cap, and rolls the renewal date forward one month.
function resetMonthlyMemberships() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contractors');
  if (!sheet || sheet.getLastRow() < 2) return;

  var lastCol = Math.max(sheet.getLastColumn(), 16);
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var today = new Date();

  for (var i = 0; i < data.length; i++) {
    var row      = data[i];
    var pkg      = row[9];    // col 10 Package
    var renewsOn = row[15];   // col 16 Renews On
    if (!isMembership(pkg) || !renewsOn) continue;

    var renewDate = parseTimestamp(renewsOn);
    if (!renewDate || renewDate > today) continue;

    var rowNum = i + 2;

    // Refresh the monthly quota
    sheet.getRange(rowNum, 12).setValue(0);   // Leads Sent -> 0

    // Reactivate if they were paused for hitting the monthly cap
    if (String(row[10]).trim() === 'Limit Reached') {
      sheet.getRange(rowNum, 11).setValue('Active');
    }

    // Roll the renewal date forward past today
    var next = renewDate;
    while (next <= today) next = addOneMonth(next);
    sheet.getRange(rowNum, 16).setValue(next);

    // Let the contractor know their leads are flowing again
    if (row[4]) {
      sendSMS(row[4],
        'Good news ' + (row[1] || '') + '! Your HVAC Flow Solutions monthly leads have refreshed. ' +
        'New exclusive leads are on the way.'
      );
    }
  }
}

function checkTrialExpirations() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contractors');
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  var today = new Date();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = row[10];
    var trialEnd = row[13];
    if (status !== 'Active' || !trialEnd) continue;

    var endDate = parseTimestamp(trialEnd);
    if (!endDate || endDate >= today) continue;

    var rowNum = i + 1;
    sheet.getRange(rowNum, 11).setValue('Trial Expired');

    var name = (row[1] || '') + ' ' + (row[3] || '');
    sendSMS(row[4], 'Hi ' + (row[1] || '') + ', your HVAC Flow Solutions free trial has ended. '
      + 'Lead delivery is now paused. Start a monthly membership to keep the exclusive leads coming - reply to this text or check your email.');
    sendSMS(getProperty('ADMIN_PHONE'), 'TRIAL EXPIRED: ' + name + ' (' + (row[14] || '') + '). Lead delivery paused.');
  }
}

function installTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === 'sendHomeownerFollowUps' || handler === 'runDailyMaintenance') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('sendHomeownerFollowUps').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('runDailyMaintenance').timeBased().everyDays(1).atHour(8).create();

  Logger.log('Triggers installed: sendHomeownerFollowUps (hourly), runDailyMaintenance (daily @ 8am).');
}

// ── Manual Admin Control ──────────────────────────────────
// Adds a "HVAC Admin" menu to the sheet so you can pause or resume
// lead delivery for any contractor at will — select their row on the
// Contractors tab first, then click the menu option.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('HVAC Admin')
    .addItem('Pause Leads for Selected Row', 'pauseSelectedContractor')
    .addItem('Resume Leads for Selected Row', 'activateSelectedContractor')
    .addToUi();
}

function pauseSelectedContractor() {
  setSelectedContractorStatus('Paused');
}

function activateSelectedContractor() {
  setSelectedContractorStatus('Active');
}

function setSelectedContractorStatus(newStatus) {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();

  if (sheet.getName() !== 'Contractors') {
    ui.alert('Select a row on the "Contractors" tab first.');
    return;
  }

  var row = sheet.getActiveRange().getRow();
  if (row < 2) {
    ui.alert('Select a contractor row (not the header) first.');
    return;
  }

  var name = sheet.getRange(row, 2).getValue() + ' ' + sheet.getRange(row, 3).getValue();
  sheet.getRange(row, 11).setValue(newStatus);
  ui.alert('Lead delivery for ' + name + ' is now: ' + newStatus);
}

// ── One-time Migration Helpers ────────────────────────────
// Run these once from the Apps Script editor if you're upgrading
// a sheet that already has data in the old 12-column format.

function migrateContractorsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contractors');
  if (!sheet || sheet.getLastRow() === 0) return;

  // Ensure the header names for columns 11-16 are present (set only if blank,
  // so existing headers are never clobbered).
  var headerNames = {
    11: 'Status', 12: 'Leads Sent', 13: 'Lead Cap',
    14: 'Trial End Date', 15: 'Client ID', 16: 'Renews On'
  };
  for (var c in headerNames) {
    var cell = sheet.getRange(1, parseInt(c, 10));
    if (!cell.getValue()) cell.setValue(headerNames[c]);
  }

  // Backfill Lead Cap (and Renews On for any existing memberships) from package.
  if (sheet.getLastRow() > 1) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 16).getValues();
    for (var i = 0; i < rows.length; i++) {
      var pkg = rows[i][9] || '';
      if (!rows[i][12]) sheet.getRange(i + 2, 13).setValue(packageToLeadCap(pkg));      // Lead Cap
      if (isMembership(pkg) && !rows[i][15]) sheet.getRange(i + 2, 16).setValue(addOneMonth(new Date())); // Renews On
    }
  }

  Logger.log('Contractors sheet migrated to 16 columns and backfilled Lead Cap / Renews On.');
}

function migrateGetQuotesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Get Quotes');
  if (!sheet || sheet.getLastRow() === 0) return;

  if (sheet.getLastColumn() >= 13) {
    Logger.log('Get Quotes sheet already has 13 columns — nothing to migrate.');
    return;
  }

  sheet.getRange(1, 13).setValue('Follow-up Sent');
  Logger.log('Migrated Get Quotes sheet to 13 columns.');
}

// ── Twilio SMS ─────────────────────────────────────────────
// Silently does nothing until TWILIO_SID / TWILIO_TOKEN / TWILIO_FROM
// are set in Script Properties — safe to deploy before Twilio is set up.

function sendSMS(to, body) {
  var formatted = normalizePhone(to);
  if (!formatted) return;

  var sid   = getProperty('TWILIO_SID');
  var token = getProperty('TWILIO_TOKEN');
  var from  = getProperty('TWILIO_FROM');
  if (!sid || !token || !from) return;

  var url = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json';
  UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
    payload: { To: formatted, From: from, Body: body },
    muteHttpExceptions: true
  });
}

function normalizePhone(raw) {
  var digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
  return digits ? '+' + digits : '';
}

function getProperty(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

// ── Test Helpers ───────────────────────────────────────────

function testSMS() {
  sendSMS(getProperty('ADMIN_PHONE'), 'Test SMS from HVAC Flow Solutions automation script.');
  Logger.log('Test SMS sent (if Twilio properties are configured).');
}

function testHomeowner() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = {
    type: 'Homeowner',
    firstName: 'Test', lastName: 'Homeowner',
    phone: '2105551234', email: 'test@example.com',
    zip: '78201', city: 'San Antonio',
    service: 'AC Repair', urgency: 'Today',
    source: 'Test', campaign: '', notes: 'Test lead'
  };
  writeHomeowner(ss, data);
  sendEmailAlert('Homeowner', data);
  notifyHomeownerInstantSMS(data);
  forwardLeadToContractor(data);
  Logger.log('testHomeowner complete.');
}

function testLeadRouting() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contractors');
  var contractor = pickContractor(sheet);
  Logger.log(contractor ? JSON.stringify(contractor) : 'No eligible contractor found.');
}

function testTrial() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = {
    type: 'Trial',
    firstName: 'Test', lastName: 'Contractor',
    bizname: 'Test HVAC Co', phone: '2105551234', email: 'test@example.com',
    website: '', cities: 'San Antonio', jobtypes: 'Install, Repair',
    leaddelivery: 'Email + SMS', notes: 'Test trial signup'
  };
  var result = appendTrialRow(ss, data);
  emailTrialSignup(data, result.clientId, result.startDate, result.endDate);
  notifyTrialSignupSMS(data, result.clientId, result.startDate, result.endDate);
  Logger.log('testTrial complete: ' + result.clientId);
}

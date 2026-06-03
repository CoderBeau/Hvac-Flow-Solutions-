// ============================================================
// HVAC Flow Solutions — Complete Automation Script
// Paste this ENTIRE file into your Google Apps Script editor,
// then Deploy > Manage deployments > Edit > New version > Deploy.
//
// Handles:
//   • Get Quotes (homeowner) leads  -> "Get Quotes" tab + email
//   • Contractor signups            -> "Contractors" tab + email + PayPal link
//   • Contractor trial signups      -> "Trials" tab + email + signature image
// ============================================================

var TRIAL_LENGTH_DAYS = 14;
var ADMIN_EMAIL = 'hvacflowsolutions@gmail.com';

// Contractor(s) who should receive homeowner leads by email.
// Add one or more email addresses here, separated by commas.
// Example: 'pro1@hvac.com, pro2@hvac.com'
var CONTRACTOR_LEAD_EMAILS = '';

// ── Entry Point ──────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.type === 'Homeowner') {
      writeHomeowner(ss, data);
      sendEmailAlert('Homeowner', data);
      forwardLeadToContractor(data);
    } else if (data.type === 'Contractor') {
      writeContractor(ss, data);
      sendEmailAlert('Contractor', data);
      sendContractorPaymentLink(data);
    } else if (data.type === 'Trial') {
      const result = appendTrialRow(ss, data);
      emailTrialSignup(data, result.clientId, result.startDate, result.endDate);
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
      'ZIP', 'City', 'Service Needed', 'Urgency', 'Source', 'Campaign', 'Notes'
    ]);
    const headerRange = sheet.getRange(1, 1, 1, 12);
    headerRange.setBackground('#0B1E3B');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    [160, 100, 100, 130, 200, 70, 120, 180, 140, 130, 160, 280]
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
    data.notes       || data.description || ''
  ]);
}

// ── Contractor writer ────────────────────────────────────────
function writeContractor(ss, data) {
  let sheet = ss.getSheetByName('Contractors');
  if (!sheet) sheet = ss.insertSheet('Contractors');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Timestamp', 'First Name', 'Last Name', 'Company', 'Phone',
      'Email', 'ZIP', 'Years in Business', 'Service Areas', 'Package Selected'
    ]);
    const headerRange = sheet.getRange(1, 1, 1, 10);
    headerRange.setBackground('#0B1E3B');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    [160, 100, 100, 200, 130, 200, 70, 130, 220, 220]
      .forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  }

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
    data.package      || ''
  ]);
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

// ── Forward homeowner lead to contractor(s) ──────────────────
function forwardLeadToContractor(data) {
  if (!CONTRACTOR_LEAD_EMAILS) return;  // no contractor set, skip

  var source = data.source || 'Website';
  var subject = 'New HVAC Lead – ' + (data.service || 'Service Request') +
                ' in ' + (data.city || data.zip || 'Texas');

  var body =
    'You have a new HVAC lead from HVAC Flow Solutions!\n\n' +
    'Name: '     + (data.firstName || '') + ' ' + (data.lastName || '') + '\n' +
    'Phone: '    + (data.phone || '') + '\n' +
    'Email: '    + (data.email || '') + '\n' +
    'ZIP: '      + (data.zip || '') + '\n' +
    'City: '     + (data.city || '') + '\n' +
    'Service: '  + (data.service || '') + '\n' +
    'Urgency: '  + (data.urgency || '') + '\n' +
    'Notes: '    + (data.notes || data.description || 'None') + '\n' +
    'Lead Source: ' + source + '\n\n' +
    'Call or text this homeowner as soon as possible to win the job.\n\n' +
    '- HVAC Flow Solutions';

  MailApp.sendEmail(CONTRACTOR_LEAD_EMAILS, subject, body);
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

// ── Trial Signup ─────────────────────────────────────────────
function appendTrialRow(ss, d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = ss.getSheetByName('Trials') || ss.insertSheet('Trials');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Client ID', 'Status', 'Start Date', 'End Date',
        'Business Name', 'First', 'Last', 'Phone', 'Email', 'Website',
        'Service Area', 'Job Types', 'Lead Delivery', 'Notes', 'Signature', 'Submitted At'
      ]);
      sheet.getRange(1, 1, 1, 16).setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(15, 200);
    }

    var tz       = 'America/Chicago';
    var now      = new Date();
    var end      = new Date(now.getTime() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000);
    var fmt      = function(dt) { return Utilities.formatDate(dt, tz, 'MM/dd/yyyy'); };
    var clientId = generateTrialClientId(sheet);

    var sigValue = 'No signature';
    var sigUrl   = '';
    if (d.signed && typeof d.signed === 'string' && d.signed.indexOf('data:image') === 0) {
      sigUrl   = saveSignatureToDrive(d.signed, clientId);
      sigValue = sigUrl;
    }

    var newRow = sheet.getLastRow() + 1;
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
      sigValue,
      d.submittedAt  || now.toLocaleString('en-US', { timeZone: tz })
    ]);

    if (sigUrl) {
      sheet.getRange(newRow, 15).setFormula('=IMAGE("' + sigUrl + '")');
      sheet.setRowHeight(newRow, 100);
    }

    return { clientId: clientId, startDate: fmt(now), endDate: fmt(end) };
  } finally {
    lock.releaseLock();
  }
}

function generateTrialClientId(sheet) {
  var year   = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy');
  var maxNum = 0;
  if (sheet.getLastRow() > 1) {
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach(function(row) {
      var m = String(row[0]).match(new RegExp('^HFS-' + year + '-(\\d+)$'));
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
  }
  return 'HFS-' + year + '-' + ('0000' + (maxNum + 1)).slice(-4);
}

function saveSignatureToDrive(base64DataUrl, clientId) {
  try {
    var base64 = base64DataUrl.split(',')[1];
    var blob = Utilities.newBlob(
      Utilities.base64Decode(base64),
      'image/png',
      'sig-' + clientId + '.png'
    );
    var folderName = 'HVAC Flow - Signatures';
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/uc?export=view&id=' + file.getId();
  } catch(err) {
    return 'Signature error: ' + err.message;
  }
}

function emailTrialSignup(d, clientId, startDate, endDate) {
  MailApp.sendEmail({
    to: ADMIN_EMAIL,
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
      'Notes: '            + (d.notes        || 'None') + '\n' +
      'Submitted: '        + (d.submittedAt  || '')
  });
}

// ── Test helpers (run manually from the editor) ──────────────
function testHomeowner() {
  writeHomeowner(SpreadsheetApp.getActiveSpreadsheet(), {
    type: 'Homeowner', firstName: 'Maria', lastName: 'Rodriguez',
    phone: '(210) 555-0100', email: 'hvacflowsolutions@gmail.com',
    zip: '78201', city: 'San Antonio', service: 'AC Repair',
    urgency: 'Emergency – Today', source: 'facebook / cpc', campaign: 'summer-ac',
    notes: 'Test lead', submittedAt: new Date().toLocaleString()
  });
  Logger.log('Test homeowner done - check the Get Quotes tab');
}

function testTrial() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = appendTrialRow(ss, {
    type: 'Trial', bizname: 'Lone Star Heating & Air',
    firstName: 'Carlos', lastName: 'Mendez', phone: '(210) 555-0300',
    email: 'hvacflowsolutions@gmail.com', website: 'lonestarhvac.com',
    cities: 'San Antonio, New Braunfels', jobTypes: 'AC Repair, Installs',
    leadDelivery: 'SMS + Email', notes: 'Test trial', signed: true,
    submittedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })
  });
  emailTrialSignup({ bizname: 'Lone Star Heating & Air', firstName: 'Carlos' }, result.clientId, result.startDate, result.endDate);
  Logger.log('Test trial done — Client ID: ' + result.clientId);
}

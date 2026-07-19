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
//   • Lead quality scoring          -> Good/Bad/Review verdict on every lead via the "Keywords" tab
//   • Dashboard API                 -> doGet() JSON feed for dashboard.html (requires DASHBOARD_KEY)
//
// Required Script Properties (Project Settings > Script Properties):
//   TWILIO_SID     — Twilio Account SID (SMS is skipped silently until this is set)
//   TWILIO_TOKEN   — Twilio Auth Token
//   TWILIO_FROM    — Your Twilio phone number, e.g. +12105551234
//   ADMIN_PHONE    — Owner's cell for alerts, e.g. +12105559999
//   DASHBOARD_KEY  — Long random password for dashboard.html (the dashboard
//                    API stays locked until this is set)
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

// ── Lead Quality Scoring ─────────────────────────────────────
// Every homeowner lead is scored against the Good/Bad keyword lists
// (editable on the "Keywords" tab of the sheet, or from dashboard.html).
// Score >= GOOD_THRESHOLD -> Good, score < BAD_THRESHOLD -> Bad,
// anything in between -> Review.
//
// Bad leads are still recorded (so nothing is ever lost) but are NOT
// routed to contractors — they don't burn anyone's lead cap. You can
// overturn any verdict from the dashboard; marking a Bad lead Good
// routes it immediately.
var GOOD_KEYWORD_POINTS = 10;
var BAD_KEYWORD_POINTS  = -15;
var GOOD_THRESHOLD      = 10;
var BAD_THRESHOLD       = 0;

// Seeded into the "Keywords" tab the first time the script runs.
// After that, the sheet (not this list) is the source of truth.
var DEFAULT_GOOD_KEYWORDS = [
  'replace', 'replacement', 'install', 'new unit', 'new system', 'new ac',
  'not cooling', 'no cold air', 'not working', 'stopped working', 'broken',
  'blowing warm', 'blowing hot', 'no heat', 'not heating', 'wont turn on',
  'leak', 'leaking', 'frozen', 'iced up', 'emergency', 'asap', 'right away',
  'quote', 'estimate', 'repair', 'installation', 'furnace', 'heat pump', 'mini split',
  'ductless', 'compressor', 'refrigerant', 'freon', 'thermostat',
  'tune up', 'maintenance', 'duct'
];
var DEFAULT_BAD_KEYWORDS = [
  'job opening', 'hiring', 'looking for work', 'apply', 'resume',
  'employment', 'career', 'home warranty', 'warranty claim', 'warranty company',
  'free service', 'for free', 'no charge', 'sell you', 'selling leads',
  'buy leads', 'marketing services', 'seo', 'web design', 'website design',
  'backlink', 'guest post', 'promote your', 'sponsor', 'wholesale',
  'parts only', 'just a part', 'do it yourself', 'diy', 'just curious',
  'just looking', 'price check', 'school project', 'homework',
  'test lead', 'test submission', 'testing the form',
  'crypto', 'bitcoin', 'loan', 'casino'
];

// ── Entry Point ──────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.type === 'Homeowner') {
      var verdict = scoreLead(data, getKeywords(ss));
      writeHomeowner(ss, data, verdict);
      sendEmailAlert('Homeowner', data, verdict);
      notifyHomeownerInstantSMS(data);
      // Bad leads are recorded but never routed — they don't burn a
      // contractor's lead cap. Reclassify from the dashboard to route.
      if (verdict.quality !== 'Bad') {
        var routed = forwardLeadToContractor(data);
        if (routed) {
          var gqSheet = ss.getSheetByName('Get Quotes');
          gqSheet.getRange(gqSheet.getLastRow(), 18)
                 .setValue(routed.company || routed.email);
        }
      }
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

// ── Dashboard API (used by dashboard.html) ───────────────────
// All requests require ?key=<DASHBOARD_KEY>. Set DASHBOARD_KEY in
// Script Properties to a long random password — the API refuses every
// request until it's set.
//
// Actions:
//   dashboard            -> full JSON snapshot (leads, contractors, keywords)
//   setQuality           -> &row=N&quality=Good|Bad|Review (Good routes the lead if it wasn't routed yet)
//   setContractorStatus  -> &row=N&status=Active|Paused
//   addKeyword           -> &kind=good|bad&word=...
//   removeKeyword        -> &kind=good|bad&word=...
function doGet(e) {
  var p = (e && e.parameter) || {};

  var key = getProperty('DASHBOARD_KEY');
  if (!key) return jsonOut({ status: 'error', message: 'Dashboard is locked. Set DASHBOARD_KEY in Script Properties first.' });
  if (p.key !== key) return jsonOut({ status: 'error', message: 'Invalid dashboard key.' });

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = p.action || 'dashboard';

    if (action === 'dashboard')           return jsonOut(getDashboardData(ss));
    if (action === 'setQuality')          return jsonOut(apiSetQuality(ss, p));
    if (action === 'setContractorStatus') return jsonOut(apiSetContractorStatus(ss, p));
    if (action === 'addKeyword')          return jsonOut(apiAddKeyword(ss, p));
    if (action === 'removeKeyword')       return jsonOut(apiRemoveKeyword(ss, p));

    return jsonOut({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut({ status: 'error', message: err.message });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getDashboardData(ss) {
  var leads = [];
  var gq = ss.getSheetByName('Get Quotes');
  if (gq && gq.getLastRow() > 1) {
    var lastCol = Math.max(gq.getLastColumn(), 18);
    gq.getRange(2, 1, gq.getLastRow() - 1, lastCol).getValues().forEach(function(r, i) {
      leads.push({
        row: i + 2,
        timestamp: String(r[0]),
        firstName: r[1], lastName: r[2], phone: String(r[3]), email: r[4],
        zip: String(r[5]), city: r[6], service: r[7], urgency: r[8],
        source: r[9], campaign: r[10], notes: r[11],
        followUpSent: r[12] ? String(r[12]) : '',
        smsConsent: r[13],
        quality: r[14] || '', score: r[15], matched: r[16] || '',
        routedTo: r[17] || ''
      });
    });
  }

  var contractors = [];
  var cs = ss.getSheetByName('Contractors');
  if (cs && cs.getLastRow() > 1) {
    var cCol = Math.max(cs.getLastColumn(), 17);
    cs.getRange(2, 1, cs.getLastRow() - 1, cCol).getValues().forEach(function(r, i) {
      contractors.push({
        row: i + 2,
        timestamp: String(r[0]),
        firstName: r[1], lastName: r[2], company: r[3],
        phone: String(r[4]), email: r[5], zip: String(r[6]),
        years: String(r[7]), serviceAreas: r[8], pkg: r[9],
        status: r[10] || 'Active',
        leadsSent: parseInt(r[11], 10) || 0,
        leadCap: (r[12] === '' || r[12] === null) ? null : parseInt(r[12], 10),
        trialEnd: r[13] ? String(r[13]) : '',
        clientId: r[14] || '',
        renewsOn: r[15] ? String(r[15]) : '',
        smsConsent: r[16] || 'No'
      });
    });
  }

  return {
    status: 'success',
    generatedAt: new Date().toISOString(),
    activeCity: ACTIVE_CITY,
    keywords: getKeywords(ss),
    leads: leads,
    contractors: contractors
  };
}

function apiSetQuality(ss, p) {
  var sheet = ss.getSheetByName('Get Quotes');
  var row = parseInt(p.row, 10);
  var quality = p.quality;
  if (!sheet || isNaN(row) || row < 2 || row > sheet.getLastRow()) throw new Error('Invalid lead row.');
  if (['Good', 'Bad', 'Review'].indexOf(quality) === -1) throw new Error('Invalid quality value.');

  sheet.getRange(row, 15).setValue(quality);

  // Overturning to Good routes the lead now — unless it already went out.
  var routedTo = String(sheet.getRange(row, 18).getValue() || '');
  if (quality === 'Good' && !routedTo) {
    var r = sheet.getRange(row, 1, 1, 18).getValues()[0];
    var routed = forwardLeadToContractor({
      firstName: r[1], lastName: r[2], phone: r[3], email: r[4],
      zip: r[5], city: r[6], service: r[7], urgency: r[8],
      source: r[9], notes: r[11]
    });
    if (routed) {
      routedTo = routed.company || routed.email;
      sheet.getRange(row, 18).setValue(routedTo);
    }
  }

  return { status: 'success', row: row, quality: quality, routedTo: routedTo };
}

function apiSetContractorStatus(ss, p) {
  var sheet = ss.getSheetByName('Contractors');
  var row = parseInt(p.row, 10);
  if (!sheet || isNaN(row) || row < 2 || row > sheet.getLastRow()) throw new Error('Invalid contractor row.');
  if (['Active', 'Paused'].indexOf(p.status) === -1) throw new Error('Invalid status value.');

  sheet.getRange(row, 11).setValue(p.status);
  return { status: 'success', row: row, contractorStatus: p.status };
}

function apiAddKeyword(ss, p) {
  var word = String(p.word || '').trim().toLowerCase();
  var kind = p.kind === 'good' ? 'good' : p.kind === 'bad' ? 'bad' : null;
  if (!word) throw new Error('Missing keyword.');
  if (!kind) throw new Error('Keyword kind must be good or bad.');

  var sheet = ensureKeywordsSheet(ss);
  var col = kind === 'good' ? 1 : 2;
  var existing = getKeywords(ss)[kind].map(function(k) { return k.toLowerCase(); });
  if (existing.indexOf(word) !== -1) return { status: 'success', message: 'Already in the list.' };

  // First empty cell in that column (below the header).
  var colValues = sheet.getRange(2, col, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  var target = sheet.getLastRow() + 1;
  for (var i = 0; i < colValues.length; i++) {
    if (!String(colValues[i][0] || '').trim()) { target = i + 2; break; }
  }
  sheet.getRange(target, col).setValue(word);
  return { status: 'success', kind: kind, word: word };
}

function apiRemoveKeyword(ss, p) {
  var word = String(p.word || '').trim().toLowerCase();
  var kind = p.kind === 'good' ? 'good' : p.kind === 'bad' ? 'bad' : null;
  if (!word || !kind) throw new Error('Missing keyword or kind.');

  var sheet = ensureKeywordsSheet(ss);
  var col = kind === 'good' ? 1 : 2;
  if (sheet.getLastRow() < 2) return { status: 'success' };

  var colRange = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
  var colValues = colRange.getValues();
  for (var i = 0; i < colValues.length; i++) {
    if (String(colValues[i][0] || '').trim().toLowerCase() === word) {
      sheet.getRange(i + 2, col).setValue('');
    }
  }
  return { status: 'success', kind: kind, word: word };
}

// ── Get Quotes (Homeowner) writer ────────────────────────────
// Columns: Timestamp | First | Last | Phone | Email | ZIP | City | Service |
//          Urgency | Source | Campaign | Notes | Follow-up Sent | SMS Consent |
//          Lead Quality | Quality Score | Matched Keywords | Routed To
function writeHomeowner(ss, data, verdict) {
  let sheet = ss.getSheetByName('Get Quotes');
  if (!sheet) sheet = ss.insertSheet('Get Quotes');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Timestamp', 'First Name', 'Last Name', 'Phone', 'Email',
      'ZIP', 'City', 'Service Needed', 'Urgency', 'Source', 'Campaign', 'Notes', 'Follow-up Sent', 'SMS Consent',
      'Lead Quality', 'Quality Score', 'Matched Keywords', 'Routed To'
    ]);
    const headerRange = sheet.getRange(1, 1, 1, 18);
    headerRange.setBackground('#0B1E3B');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    [160, 100, 100, 130, 200, 70, 120, 180, 140, 130, 160, 280, 130, 110, 100, 90, 220, 160]
      .forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  }

  if (!verdict) verdict = scoreLead(data, getKeywords(ss));

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
    '',                        // Follow-up Sent — filled in by sendHomeownerFollowUps()
    data.smsConsent || 'No',   // SMS Consent — 'Yes' only if they opted in
    verdict.quality,
    verdict.score,
    formatMatchedKeywords(verdict),
    ''                         // Routed To — filled in after routing
  ]);
}

// ── Lead scoring engine ──────────────────────────────────────
// Scans the service + notes text for good/bad keywords, then applies a
// few signal rules (urgency, phone validity, links in notes).
function scoreLead(data, keywords) {
  var text = ((data.service || '') + ' ' + (data.notes || data.description || '')).toLowerCase();
  var matchedGood = [], matchedBad = [];

  // Whole-word/phrase match so short keywords can't fire inside longer
  // words (e.g. "seo" inside "seasonal", "ice" inside "services").
  function hits(keyword) {
    var k = String(keyword || '').trim().toLowerCase();
    if (!k) return false;
    var escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + escaped + '\\b').test(text);
  }

  keywords.good.forEach(function(k) { if (hits(k)) matchedGood.push(k); });
  keywords.bad.forEach(function(k)  { if (hits(k)) matchedBad.push(k); });

  var score = matchedGood.length * GOOD_KEYWORD_POINTS
            + matchedBad.length  * BAD_KEYWORD_POINTS;

  // Urgency: an urgent homeowner is a buying homeowner.
  var urgency = String(data.urgency || '').toLowerCase();
  if (urgency.indexOf('emergency') !== -1 || urgency.indexOf('today') !== -1 || urgency.indexOf('asap') !== -1) {
    score += 15;
  } else if (urgency.indexOf('week') !== -1) {
    score += 5;
  }

  // Phone: a real, callable number is the whole product.
  var digits = String(data.phone || '').replace(/\D/g, '');
  if (digits.length === 10 || (digits.length === 11 && digits.charAt(0) === '1')) {
    score += 5;
  } else {
    score -= 15;
  }

  // Links in the notes are almost always spam/solicitation.
  var notes = String(data.notes || data.description || '').toLowerCase();
  if (notes.indexOf('http') !== -1 || notes.indexOf('www.') !== -1) {
    score -= 25;
    matchedBad.push('link in notes');
  }

  var quality = score >= GOOD_THRESHOLD ? 'Good'
              : score < BAD_THRESHOLD   ? 'Bad'
              : 'Review';

  return { quality: quality, score: score, matchedGood: matchedGood, matchedBad: matchedBad };
}

// "+replace, +today | -hiring" — readable in a sheet cell.
function formatMatchedKeywords(verdict) {
  var parts = [];
  if (verdict.matchedGood.length) parts.push(verdict.matchedGood.map(function(k) { return '+' + k; }).join(', '));
  if (verdict.matchedBad.length)  parts.push(verdict.matchedBad.map(function(k) { return '-' + k; }).join(', '));
  return parts.join(' | ');
}

// ── Keywords sheet ───────────────────────────────────────────
// Two columns: "Good Keywords" | "Bad Keywords". Edit it directly in the
// sheet or from dashboard.html — the scorer re-reads it on every lead.
function ensureKeywordsSheet(ss) {
  var sheet = ss.getSheetByName('Keywords');
  if (sheet) return sheet;

  sheet = ss.insertSheet('Keywords');
  sheet.appendRow(['Good Keywords', 'Bad Keywords']);
  var headerRange = sheet.getRange(1, 1, 1, 2);
  headerRange.setBackground('#0B1E3B');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 220);

  var rows = Math.max(DEFAULT_GOOD_KEYWORDS.length, DEFAULT_BAD_KEYWORDS.length);
  var values = [];
  for (var i = 0; i < rows; i++) {
    values.push([DEFAULT_GOOD_KEYWORDS[i] || '', DEFAULT_BAD_KEYWORDS[i] || '']);
  }
  sheet.getRange(2, 1, rows, 2).setValues(values);
  return sheet;
}

function getKeywords(ss) {
  var sheet = ensureKeywordsSheet(ss);
  if (sheet.getLastRow() < 2) return { good: [], bad: [] };

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var good = [], bad = [];
  values.forEach(function(row) {
    var g = String(row[0] || '').trim();
    var b = String(row[1] || '').trim();
    if (g) good.push(g);
    if (b) bad.push(b);
  });
  return { good: good, bad: bad };
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
    'Status', 'Leads Sent', 'Lead Cap', 'Trial End Date', 'Client ID', 'Renews On', 'SMS Consent'
  ]);
  const headerRange = sheet.getRange(1, 1, 1, 17);
  headerRange.setBackground('#0B1E3B');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
  [160, 100, 100, 200, 130, 200, 70, 130, 220, 140, 100, 90, 80, 120, 110, 120, 110]
    .forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

// Derives SMS consent from a trial contractor's chosen lead-delivery method
// (they explicitly picked Text / SMS / Both), returning 'Yes' or 'No'.
function smsFromDelivery(pref) {
  pref = String(pref || '').toLowerCase();
  return (pref.indexOf('text') !== -1 || pref.indexOf('sms') !== -1 || pref.indexOf('both') !== -1) ? 'Yes' : 'No';
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
    renewsOn,                 // Renews On — membership billing anniversary (blank for one-time packs)
    data.smsConsent || 'No'   // SMS Consent — 'Yes' only if they opted in
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
function sendEmailAlert(type, data, verdict) {
  let subject, body;

  if (type === 'Homeowner') {
    var qualityTag = verdict ? '[' + verdict.quality.toUpperCase() + ' LEAD] ' : '';
    subject = qualityTag + '🔥 New Quote Request – ' + (data.service || '') + ' in ' + (data.city || data.zip || '');
    body =
      'New homeowner quote request just came in!\n\n' +
      (verdict
        ? 'Lead Quality: ' + verdict.quality + ' (score ' + verdict.score + ')\n' +
          'Matched Keywords: ' + (formatMatchedKeywords(verdict) || 'none') + '\n' +
          (verdict.quality === 'Bad'
            ? '>> NOT routed to a contractor. Review it on the dashboard - marking it Good will route it.\n'
            : '') +
          '\n'
        : '') +
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
  if (data.smsConsent !== 'Yes') return;   // only text homeowners who opted in
  sendSMS(data.phone,
    'Thanks ' + (data.firstName || '') + '! HVAC Flow Solutions got your ' +
    (data.service || 'service') + ' request. A local licensed contractor will reach out shortly. ' +
    'Msg & data rates may apply. Reply STOP to opt out, HELP for help.'
  );
}

function sendHomeownerFollowUps() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Get Quotes');
  if (!sheet || sheet.getLastRow() < 2) return;

  var lastCol = Math.max(sheet.getLastColumn(), 15);
  var rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var cutoffMs = HOMEOWNER_FOLLOWUP_HOURS * 60 * 60 * 1000;
  var now = new Date();

  rows.forEach(function(row, i) {
    if (row[12]) return;              // Follow-up Sent already set
    if (row[13] !== 'Yes') return;    // no SMS consent — never text this homeowner
    if (row[14] === 'Bad') return;    // bad lead — no contractor was sent, skip the check-in

    var submittedAt = parseTimestamp(row[0]);
    if (!submittedAt) return;

    if (now.getTime() - submittedAt.getTime() >= cutoffMs) {
      var phone     = row[3];
      var firstName = row[1];
      var service   = row[7];
      if (phone) {
        sendSMS(phone,
          'Hi ' + (firstName || '') + ', this is HVAC Flow Solutions checking in on your ' +
          (service || 'HVAC') + ' request. Did a contractor reach out yet? Reply and let us know if you still need help. ' +
          'Reply STOP to opt out.'
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
  if (data.phone && data.smsConsent === 'Yes') {   // only text contractors who opted in
    sendSMS(data.phone,
      'Welcome to HVAC Flow Solutions, ' + data.firstName + '! Your ' + data.package +
      ' application is received. Check your email for the payment link to activate lead delivery. ' +
      'Reply STOP to opt out, HELP for help.'
    );
  }
  sendSMS(getProperty('ADMIN_PHONE'),
    'NEW CONTRACTOR SIGNUP: ' + data.firstName + ' ' + data.lastName + ' (' + data.company + ') - ' +
    data.package + ' - ' + data.phone
  );
}

// ── SMS: Trial signup welcome + admin alert ──────────────────
function notifyTrialSignupSMS(d, clientId, startDate, endDate) {
  if (d.phone && smsFromDelivery(d.leaddelivery) === 'Yes') {   // only if they chose Text/Both delivery
    sendSMS(d.phone,
      'Welcome to your HVAC Flow Solutions free trial, ' + (d.firstName || '') + '! Client ID ' + clientId +
      '. Your trial runs ' + startDate + ' to ' + endDate + '. Leads will start arriving shortly. ' +
      'Reply STOP to opt out, HELP for help.'
    );
  }
  sendSMS(getProperty('ADMIN_PHONE'),
    'NEW TRIAL SIGNUP: ' + (d.bizname || d.firstName) + ' [' + clientId + '] trial ' + startDate + '–' + endDate
  );
}

// ── Lead routing — round-robin for ACTIVE_CITY ───────────────
// Returns the contractor the lead was routed to ({email, company, ...}),
// or null if no eligible contractor was found.
function forwardLeadToContractor(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contractors');
  var contractor = pickContractor(sheet);
  if (!contractor) return null;  // no active contractors under cap, skip

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

  if (contractor.phone && contractor.smsConsent === 'Yes') {
    sendSMS(contractor.phone,
      'NEW LEAD – ' + (data.service || 'HVAC') + ' in ' + (data.city || data.zip || 'TX') + '\n' +
      'Name: '    + (data.firstName || '') + ' ' + (data.lastName || '') + '\n' +
      'Phone: '   + (data.phone || '') + '\n' +
      'Urgency: ' + (data.urgency || '') + '\n' +
      'Call them back ASAP to win the job. Reply STOP to opt out.'
    );
  }

  incrementLeadCount(sheet, contractor.row);
  enforceLeadCap(sheet, contractor.row, contractor.leadCap);
  return contractor;
}

// Picks the active contractor in ACTIVE_CITY with the fewest leads sent,
// skipping anyone over their package's lead cap. Ties go to whoever
// signed up first (top of the sheet). Blank Status counts as Active.
function pickContractor(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return null;

  var lastCol = Math.max(sheet.getLastColumn(), 17);
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
    var smsConsent   = String(row[16]).trim();          // col 17
    var leadCap      = (leadCapRaw === '' || leadCapRaw === null || isNaN(parseInt(leadCapRaw, 10)))
      ? null : parseInt(leadCapRaw, 10);

    var isActive   = (status === 'Active' || status === '');
    var coversCity = (serviceAreas.indexOf(city) !== -1);
    var underCap   = (leadCap === null || leadsCount < leadCap);

    if (isActive && coversCity && email && underCap) {
      candidates.push({ row: i + 2, email: email, phone: phone, company: String(row[3]).trim(), leadsCount: leadsCount, leadCap: leadCap, smsConsent: smsConsent });
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
  var smsOk  = String(sheet.getRange(rowIndex, 17).getValue()).trim() === 'Yes';

  if (phone && smsOk) {
    if (member) {
      var renews = parseTimestamp(sheet.getRange(rowIndex, 16).getValue());
      sendSMS(phone,
        'You have received all ' + leadCap + ' leads in your ' + pkg + ' this cycle. Your leads ' +
        'automatically refresh' + (renews ? ' on ' + renews.toLocaleDateString() : ' on your next billing date') + '. ' +
        'Reply STOP to opt out.'
      );
    } else {
      sendSMS(phone,
        'You have used all ' + leadCap + ' leads in your ' + pkg + ' package. Lead delivery is paused ' +
        'until you renew or upgrade. Reply to this text or contact us to choose a new package. Reply STOP to opt out.'
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
    '',                                // Renews On — trials are not monthly memberships
    smsFromDelivery(d.leaddelivery)    // SMS Consent — from their Text/Email/Both choice
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

  var lastCol = Math.max(sheet.getLastColumn(), 17);
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

    // Let the contractor know their leads are flowing again (if they opted into SMS)
    if (row[4] && String(row[16]).trim() === 'Yes') {
      sendSMS(row[4],
        'Good news ' + (row[1] || '') + '! Your HVAC Flow Solutions monthly leads have refreshed. ' +
        'New exclusive leads are on the way. Reply STOP to opt out, HELP for help.'
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
    if (String(row[16]).trim() === 'Yes') {   // only text if they opted in
      sendSMS(row[4], 'Hi ' + (row[1] || '') + ', your HVAC Flow Solutions free trial has ended. '
        + 'Lead delivery is now paused. Start a monthly membership to keep the exclusive leads coming - reply to this text or check your email. Reply STOP to opt out.');
    }
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
    .addItem('Rescore All Unscored Leads', 'rescoreUnscoredLeads')
    .addToUi();
}

// Scores any Get Quotes row whose Lead Quality cell is still blank
// (i.e. rows written before the scoring upgrade). Never overwrites an
// existing verdict and never re-routes anything.
function rescoreUnscoredLeads() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Get Quotes');
  if (!sheet || sheet.getLastRow() < 2) return;

  var keywords = getKeywords(ss);
  var lastCol = Math.max(sheet.getLastColumn(), 18);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var scored = 0;

  rows.forEach(function(r, i) {
    if (r[14]) return;   // already has a verdict
    var verdict = scoreLead({
      phone: r[3], service: r[7], urgency: r[8], notes: r[11]
    }, keywords);
    sheet.getRange(i + 2, 15, 1, 3)
         .setValues([[verdict.quality, verdict.score, formatMatchedKeywords(verdict)]]);
    scored++;
  });

  Logger.log('Rescored ' + scored + ' lead(s).');
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
    14: 'Trial End Date', 15: 'Client ID', 16: 'Renews On', 17: 'SMS Consent'
  };
  for (var c in headerNames) {
    var cell = sheet.getRange(1, parseInt(c, 10));
    if (!cell.getValue()) cell.setValue(headerNames[c]);
  }

  // Backfill Lead Cap, Renews On (memberships), and SMS Consent from existing data.
  if (sheet.getLastRow() > 1) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 17).getValues();
    for (var i = 0; i < rows.length; i++) {
      var pkg = rows[i][9] || '';
      if (!rows[i][12]) sheet.getRange(i + 2, 13).setValue(packageToLeadCap(pkg));      // Lead Cap
      if (isMembership(pkg) && !rows[i][15]) sheet.getRange(i + 2, 16).setValue(addOneMonth(new Date())); // Renews On
      if (!rows[i][16]) sheet.getRange(i + 2, 17).setValue('No');                       // SMS Consent (default No for old rows)
    }
  }

  Logger.log('Contractors sheet migrated to 17 columns and backfilled Lead Cap / Renews On / SMS Consent.');
}

function migrateGetQuotesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Get Quotes');
  if (!sheet || sheet.getLastRow() === 0) return;

  var headerNames = {
    13: 'Follow-up Sent', 14: 'SMS Consent',
    15: 'Lead Quality', 16: 'Quality Score', 17: 'Matched Keywords', 18: 'Routed To'
  };
  for (var c in headerNames) {
    var cell = sheet.getRange(1, parseInt(c, 10));
    if (!cell.getValue()) cell.setValue(headerNames[c]);
  }

  ensureKeywordsSheet(ss);
  Logger.log('Migrated Get Quotes sheet to 18 columns and created the Keywords tab. ' +
             'Run "Rescore All Unscored Leads" from the HVAC Admin menu to score existing rows.');
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
    source: 'Test', campaign: '', notes: 'AC not cooling, need someone today',
    smsConsent: 'Yes'
  };
  var verdict = scoreLead(data, getKeywords(ss));
  writeHomeowner(ss, data, verdict);
  sendEmailAlert('Homeowner', data, verdict);
  notifyHomeownerInstantSMS(data);
  if (verdict.quality !== 'Bad') forwardLeadToContractor(data);
  Logger.log('testHomeowner complete. Verdict: ' + verdict.quality + ' (' + verdict.score + ')');
}

// Runs a few sample leads through the scorer without writing anything.
function testLeadScoring() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var keywords = getKeywords(ss);
  var samples = [
    { label: 'GOOD: urgent repair',   phone: '2105551234', service: 'AC Repair',  urgency: 'Today',      notes: 'AC not cooling, blowing warm air' },
    { label: 'GOOD: replacement',     phone: '2105551234', service: 'New System', urgency: 'This Week',  notes: 'Need a quote to replace my old unit' },
    { label: 'BAD: job seeker',       phone: '2105551234', service: 'Other',      urgency: 'Just Planning', notes: 'I am hiring? no - looking for work, here is my resume' },
    { label: 'BAD: spam with link',   phone: '',           service: 'Other',      urgency: '',           notes: 'Grow your business!! visit www.example-seo.com' },
    { label: 'REVIEW: vague, no keywords', phone: '2105551234', service: 'Other', urgency: 'Just Planning', notes: 'Have a question' }
  ];
  samples.forEach(function(s) {
    var v = scoreLead(s, keywords);
    Logger.log(s.label + ' -> ' + v.quality + ' (score ' + v.score + ') [' + formatMatchedKeywords(v) + ']');
  });
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

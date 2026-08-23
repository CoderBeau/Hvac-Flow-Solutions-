// ============================================================
// HVAC Flow Solutions — Prospect Outreach Center (server side)
//
// Companion to contractor-automation.gs. In the Apps Script editor:
//   Files (+) > Script > name it "prospect-outreach" > paste this file.
// Both files share one project, so this code plugs into the existing
// doGet()/doPost() in contractor-automation.gs (see the two small
// hooks added there) and reuses sendSMS(), getProperty(), jsonOut(),
// normalizePhone() and ADMIN_EMAIL from it.
//
// What this powers:
//   • "Prospects" tab       -> HVAC contractors currently paying for
//                              shared leads (Angi/Thumbtack/etc.), added
//                              by the scraper (scraper/) or by hand.
//   • Drafted outreach      -> every prospect gets a personalized,
//                              pain-led 4-touch sequence (email + SMS)
//                              generated from their platform + city.
//   • Approve-and-send      -> prospects.html shows each draft; NOTHING
//                              is ever sent until you press Send there.
//   • "Outreach Log" tab    -> permanent record of every touch sent.
//
// Compliance is enforced server-side, not left to memory:
//   • Emails always end with the business identity, the physical
//     address (BUSINESS_ADDRESS Script Property), and an opt-out
//     line (CAN-SPAM).
//   • SMS only goes out Mon–Sat between SMS_HOURS in Central time,
//     always identifies the business, and the first text always
//     carries "Reply STOP to opt out" (TCPA hygiene).
//   • A prospect marked "Opted Out" can never be sent anything.
//   • Import silently skips anyone already on your Contractors tab —
//     you never cold-pitch an existing customer or trial.
//
// Extra Script Property (Project Settings > Script Properties):
//   BUSINESS_ADDRESS — your physical mailing address, printed in the
//   footer of every outreach email. CAN-SPAM requires a real postal
//   address; until it's set a placeholder is used and prospects.html
//   shows a warning.
// ============================================================

// ── Outreach config ──────────────────────────────────────────
var OUTREACH_SENDER = 'Beau';                       // first name signed on every message
var OUTREACH_SITE   = 'boosthvacleads.com';
var OUTREACH_TZ     = 'America/Chicago';            // all prospects are Texas
var SMS_HOURS       = { start: 9, end: 19 };        // 9am–7pm Central
var SMS_DAYS        = [1, 2, 3, 4, 5, 6];           // Mon–Sat (0 = Sunday)

// Keep these matched to the live Tester pack on pricing.html /
// STRIPE_LINKS — touch 3 quotes them, and quoting a stale price to a
// prospect burns the trust the whole pitch depends on.
var TESTER_PRICE = '$75';
var TESTER_LEADS = '5';

// The 4-touch cadence. "day" is days after the previous touch was
// sent (touch 1 is day 0). Advancing only happens when YOU send or
// skip a touch — the clock never sends anything by itself.
var PROSPECT_SEQUENCE = [
  { gap: 0, channel: 'email', label: 'Intro — pain-led opener' },
  { gap: 2, channel: 'sms',   label: 'Text intro + free sample offer' },
  { gap: 3, channel: 'email', label: 'Tester pack — risk reversal' },
  { gap: 4, channel: 'email', label: 'Break-up' }
];

var PROSPECT_STATUSES = ['New', 'In Sequence', 'Sequence Done', 'Replied', 'Won', 'Lost', 'Opted Out'];

// ── Prospects sheet ──────────────────────────────────────────
// Columns: Added At | Business | First | Last | City | ZIP | Phone |
//          Email | Website | Platforms | Pain Signal | Tier | Score |
//          Source | Status | Stage | Next Touch | Last Touch | Notes
// Stage = how many touches have been sent (0–4). All reads are
// positional — append columns, never insert.
function ensureProspectsSheet(ss) {
  var sheet = ss.getSheetByName('Prospects');
  if (sheet) return sheet;

  sheet = ss.insertSheet('Prospects');
  sheet.appendRow([
    'Added At', 'Business', 'First Name', 'Last Name', 'City', 'ZIP',
    'Phone', 'Email', 'Website', 'Platforms', 'Pain Signal', 'Tier',
    'Score', 'Source', 'Status', 'Stage', 'Next Touch', 'Last Touch', 'Notes'
  ]);
  var header = sheet.getRange(1, 1, 1, 19);
  header.setBackground('#0B1E3B');
  header.setFontColor('#FFFFFF');
  header.setFontWeight('bold');
  sheet.setFrozenRows(1);
  [150, 200, 100, 100, 120, 70, 130, 210, 200, 170, 220, 70, 60, 130, 110, 60, 110, 140, 240]
    .forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  return sheet;
}

function ensureOutreachLogSheet(ss) {
  var sheet = ss.getSheetByName('Outreach Log');
  if (sheet) return sheet;

  sheet = ss.insertSheet('Outreach Log');
  sheet.appendRow([
    'Timestamp', 'Prospect Row', 'Business', 'Contact', 'Channel',
    'Touch #', 'Sent To', 'Subject', 'Body', 'Result'
  ]);
  var header = sheet.getRange(1, 1, 1, 10);
  header.setBackground('#0B1E3B');
  header.setFontColor('#FFFFFF');
  header.setFontWeight('bold');
  sheet.setFrozenRows(1);
  [150, 90, 200, 140, 80, 70, 210, 260, 420, 140].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  return sheet;
}

function readProspect(sheet, rowNum) {
  var r = sheet.getRange(rowNum, 1, 1, 19).getValues()[0];
  return prospectFromRow(r, rowNum);
}

function prospectFromRow(r, rowNum) {
  return {
    row: rowNum,
    addedAt:    String(r[0] || ''),
    business:   String(r[1] || ''),
    firstName:  String(r[2] || ''),
    lastName:   String(r[3] || ''),
    city:       String(r[4] || ''),
    zip:        String(r[5] || ''),
    phone:      String(r[6] || ''),
    email:      String(r[7] || ''),
    website:    String(r[8] || ''),
    platforms:  String(r[9] || ''),
    painSignal: String(r[10] || ''),
    tier:       String(r[11] || 'Warm'),
    score:      (r[12] === '' || r[12] === null) ? '' : Number(r[12]),
    source:     String(r[13] || ''),
    status:     String(r[14] || 'New'),
    stage:      parseInt(r[15], 10) || 0,
    nextTouch:  r[16] ? String(r[16]) : '',
    lastTouch:  r[17] ? String(r[17]) : '',
    notes:      String(r[18] || '')
  };
}

// ── Dedupe helpers ───────────────────────────────────────────
function normBiz(s)   { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normEmail(s) { return String(s || '').trim().toLowerCase(); }
function normPhoneKey(s) {
  var d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d;
}

// Index of everyone already known: existing prospects AND existing
// contractors/trials (never cold-pitch a current customer).
function buildKnownIndex(ss) {
  var idx = { biz: {}, email: {}, phone: {} };

  var ps = ss.getSheetByName('Prospects');
  if (ps && ps.getLastRow() > 1) {
    ps.getRange(2, 1, ps.getLastRow() - 1, 19).getValues().forEach(function(r, i) {
      var rowNum = i + 2;
      var b = normBiz(r[1]), e = normEmail(r[7]), p = normPhoneKey(r[6]);
      if (b) idx.biz[b] = { kind: 'prospect', row: rowNum };
      if (e) idx.email[e] = { kind: 'prospect', row: rowNum };
      if (p) idx.phone[p] = { kind: 'prospect', row: rowNum };
    });
  }

  var cs = ss.getSheetByName('Contractors');
  if (cs && cs.getLastRow() > 1) {
    cs.getRange(2, 1, cs.getLastRow() - 1, 6).getValues().forEach(function(r) {
      var b = normBiz(r[3]), e = normEmail(r[5]), p = normPhoneKey(r[4]);
      if (b) idx.biz[b] = { kind: 'contractor' };
      if (e) idx.email[e] = { kind: 'contractor' };
      if (p) idx.phone[p] = { kind: 'contractor' };
    });
  }
  return idx;
}

function findKnown(idx, prospect) {
  return idx.biz[normBiz(prospect.business)]
      || idx.email[normEmail(prospect.email)]
      || idx.phone[normPhoneKey(prospect.phone)]
      || null;
}

// Fallback tier when the scraper didn't score: multiple platforms
// means they're paying several lead vendors at once — the warmest
// possible signal. One platform is Warm; none identified is Cool.
function defaultTier(platforms) {
  var n = String(platforms || '').split(',').filter(function(s) { return s.trim(); }).length;
  return n >= 2 ? 'Hot' : (n === 1 ? 'Warm' : 'Cool');
}

// ── Draft generation ─────────────────────────────────────────
// Every draft is pain-led and platform-specific (see the platform
// playbook): Thumbtack pros get the "paying for ghosts" wedge,
// Angi/HomeAdvisor the "shared leads + contract trap" wedge, and so
// on. One pain per message — a list of four reads like a brochure.

function primaryPlatform(platforms) {
  var s = String(platforms || '').toLowerCase();
  if (s.indexOf('thumbtack') !== -1)   return 'Thumbtack';
  if (s.indexOf('angi') !== -1)        return 'Angi';
  if (s.indexOf('homeadvisor') !== -1) return 'HomeAdvisor';
  if (s.indexOf('modernize') !== -1)   return 'Modernize';
  if (s.indexOf('networx') !== -1)     return 'Networx';
  var first = String(platforms || '').split(',')[0].trim();
  return first || '';
}

function outreachAddress() {
  return getProperty('BUSINESS_ADDRESS') || '[Set BUSINESS_ADDRESS in Script Properties]';
}

function emailFooter() {
  return '\n\n— ' + OUTREACH_SENDER + ', HVAC Flow Solutions · ' + OUTREACH_SITE +
         '\n' + outreachAddress() +
         '\nReply "no thanks" and we won\'t email again.';
}

// Returns { channel, subject, body } for the prospect's next touch,
// or null when the sequence is complete.
function draftTouch(p) {
  if (p.stage >= PROSPECT_SEQUENCE.length) return null;

  var step     = PROSPECT_SEQUENCE[p.stage];
  var first    = p.firstName.trim();
  var greetHi  = first ? 'Hi ' + first + ',' : 'Hi there,';
  var city     = p.city.trim() || 'your area';
  var biz      = p.business.trim() || 'your company';
  var platform = primaryPlatform(p.platforms);
  var platOrSites = platform || 'the lead sites';
  var subject = '', body = '';

  if (p.stage === 0) {
    // Touch 1 — email, pain-led opener (platform variant)
    if (platform === 'Thumbtack') {
      subject = 'Quick question about your Thumbtack leads';
      body = greetHi + '\n\n' +
        'Saw ' + biz + ' on Thumbtack. How many leads are you getting charged for that never text you back? ' +
        'That\'s the #1 thing we hear from HVAC pros — paying for a "lead" that ghosts after one message.\n\n' +
        'At HVAC Flow Solutions you only ever pay for a real ' + city + ' homeowner with a real HVAC need — ' +
        'and it\'s exclusively yours, never shared. Month-to-month, cancel anytime.\n\n' +
        'Can I send you one free sample lead to see for yourself? No cost, no commitment.';
    } else if (platform === 'Angi' || platform === 'HomeAdvisor') {
      subject = 'Tired of splitting ' + city + ' leads 5 ways?';
      body = greetHi + '\n\n' +
        'Saw ' + biz + ' is active on ' + platform + '. Quick question — how many other contractors are you ' +
        'splitting each ' + city + ' lead with these days? Most HVAC shops we talk to are racing 5+ companies ' +
        'to the phone, then paying for the ones that never even answer.\n\n' +
        'We do the opposite at HVAC Flow Solutions: every lead is a real ' + city + ' homeowner with an actual ' +
        'HVAC problem, sold to you only, never resold. No 12-month contract, no minimum spend.\n\n' +
        'Want me to send you one free sample lead so you can see the quality? No cost, no commitment.';
    } else if (platform === 'Networx') {
      subject = 'Are you paying twice for the same ' + city + ' lead?';
      body = greetHi + '\n\n' +
        'Saw ' + biz + ' listed across the lead-gen sites. Ever paid for a ' + city + ' "lead" you\'re pretty ' +
        'sure you already saw somewhere else? Aggregators resell the same homeowner request all over the place.\n\n' +
        'At HVAC Flow Solutions every lead is generated for you, sold to you only, once — a real ' + city +
        ' homeowner with a real HVAC problem. No contract, cancel anytime.\n\n' +
        'Want one free sample lead to check the quality? No cost, no commitment.';
    } else if (platform === 'Modernize') {
      subject = 'Paying premium for leads your competitors also get?';
      body = greetHi + '\n\n' +
        'Saw ' + biz + ' picking up install leads around ' + city + '. Paying top dollar for "high-intent" ' +
        'leads that still go to three of your competitors gets old fast — exclusive should mean exclusive.\n\n' +
        'At HVAC Flow Solutions every lead is a real ' + city + ' homeowner, sold to you only, never resold. ' +
        'No contract, no minimum spend.\n\n' +
        'Want one free sample lead so you can compare quality? No cost, no commitment.';
    } else {
      subject = first ? (first + ' — exclusive HVAC leads in ' + city) : ('Exclusive HVAC leads in ' + city);
      body = greetHi + '\n\n' +
        'We run ' + OUTREACH_SITE + ' — exclusive HVAC leads in ' + city + '. Every lead is a real homeowner ' +
        'with a real HVAC problem, sold to one contractor only, never resold. No contract, no minimum spend.\n\n' +
        'If you\'ve ever paid a lead site for a homeowner that four other companies were already calling, ' +
        'this is the opposite of that.\n\n' +
        'Want me to send you one free sample lead so you can see the quality? No cost, no commitment.';
    }
    body += emailFooter();

  } else if (p.stage === 1) {
    // Touch 2 — SMS. Identifies the business and carries STOP (first text).
    if (platform === 'Thumbtack') {
      body = 'Hi ' + (first || 'there') + ', this is ' + OUTREACH_SENDER + ' w/ HVAC Flow Solutions (' + OUTREACH_SITE + '). ' +
        'With us you never pay for a lead that ghosts you — every ' + city + ' lead is a real homeowner, yours only. ' +
        'Can I send you 1 free sample lead? Reply STOP to opt out.';
    } else if (platform === 'Angi' || platform === 'HomeAdvisor') {
      body = 'Hi ' + (first || 'there') + ', this is ' + OUTREACH_SENDER + ' w/ HVAC Flow Solutions (' + OUTREACH_SITE + '). ' +
        'No contract, no minimum spend, and your ' + city + ' leads are never split with other contractors. ' +
        'Want a free sample lead to compare? Reply STOP to opt out.';
    } else {
      body = 'Hi ' + (first || 'there') + ', this is ' + OUTREACH_SENDER + ' w/ HVAC Flow Solutions (' + OUTREACH_SITE + '). ' +
        'We do exclusive ' + city + ' HVAC leads — never shared, never resold. ' +
        'Can I send you 1 free sample lead to check the quality? Reply STOP to opt out.';
    }

  } else if (p.stage === 2) {
    // Touch 3 — email, Tester-pack risk reversal
    subject = 'Test us for ' + TESTER_PRICE + ' — without touching your ' + platOrSites + ' budget';
    body = (first ? first + ', no' : 'No') + ' pressure — but if you want to test this without touching your ' +
      platOrSites + ' budget, our Tester pack is ' + TESTER_LEADS + ' exclusive ' + city + ' leads for ' +
      TESTER_PRICE + '. Every one is a real homeowner, sold to you alone. If they\'re not better than what ' +
      'you\'re getting now, you\'ve lost almost nothing.\n\n' +
      'Want the link? And the free sample lead offer still stands.';
    body += emailFooter();

  } else {
    // Touch 4 — email, break-up
    subject = first ? ('Last one from me, ' + first) : 'Last one from me';
    body = greetHi + '\n\n' +
      'I\'ll stop here so I\'m not cluttering your inbox. If splitting leads and paying for no-shows ever ' +
      'gets old, we\'re at ' + OUTREACH_SITE + ' and the free sample lead offer stands.\n\n' +
      'Wishing ' + biz + ' a strong season.';
    body += emailFooter();
  }

  return { channel: step.channel, label: step.label, touch: p.stage + 1, subject: subject, body: body };
}

// ── Due / scheduling helpers ─────────────────────────────────
function prospectIsSendable(p) {
  return p.status !== 'Opted Out' && p.status !== 'Won' && p.status !== 'Lost' &&
         p.status !== 'Replied' && p.stage < PROSPECT_SEQUENCE.length;
}

function prospectIsDue(p, now) {
  if (!prospectIsSendable(p)) return false;
  if (p.stage === 0) return true;                       // never touched — due immediately
  if (!p.nextTouch) return true;
  var next = new Date(p.nextTouch);
  if (isNaN(next.getTime())) return true;
  return next.getTime() <= now.getTime();
}

function smsWindowOpen() {
  var now  = new Date();
  var hour = parseInt(Utilities.formatDate(now, OUTREACH_TZ, 'H'), 10);
  var day  = parseInt(Utilities.formatDate(now, OUTREACH_TZ, 'u'), 10) % 7;  // 1=Mon..7=Sun -> 0=Sun
  return SMS_DAYS.indexOf(day) !== -1 && hour >= SMS_HOURS.start && hour < SMS_HOURS.end;
}

// ── API (routed from doGet in contractor-automation.gs) ──────
// Returns null for actions that aren't ours so doGet can keep looking.
function prospectApi(ss, action, p) {
  if (action === 'prospects')          return apiListProspects(ss);
  if (action === 'addProspect')        return apiAddProspect(ss, p);
  if (action === 'updateProspect')     return apiUpdateProspect(ss, p);
  if (action === 'setProspectStatus')  return apiSetProspectStatus(ss, p);
  if (action === 'sendProspectTouch')  return apiSendProspectTouch(ss, p);
  if (action === 'skipProspectTouch')  return apiSkipProspectTouch(ss, p);
  return null;
}

function apiListProspects(ss) {
  var sheet = ensureProspectsSheet(ss);
  var now = new Date();
  var prospects = [];

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 19).getValues().forEach(function(r, i) {
      var p = prospectFromRow(r, i + 2);
      var draft = draftTouch(p);
      p.due = prospectIsDue(p, now);
      p.draft = draft;   // null once the sequence is complete
      prospects.push(p);
    });
  }

  return {
    status: 'success',
    generatedAt: new Date().toISOString(),
    smsWindowOpen: smsWindowOpen(),
    addressSet: !!getProperty('BUSINESS_ADDRESS'),
    twilioSet: !!getProperty('TWILIO_SID'),
    emailQuotaRemaining: MailApp.getRemainingDailyQuota(),
    sequence: PROSPECT_SEQUENCE.map(function(s) { return { channel: s.channel, label: s.label, gap: s.gap }; }),
    statuses: PROSPECT_STATUSES,
    prospects: prospects
  };
}

function apiAddProspect(ss, p) {
  var sheet = ensureProspectsSheet(ss);
  var prospect = {
    business:   String(p.business || '').trim(),
    firstName:  String(p.firstName || '').trim(),
    lastName:   String(p.lastName || '').trim(),
    city:       String(p.city || '').trim(),
    zip:        String(p.zip || '').trim(),
    phone:      String(p.phone || '').trim(),
    email:      String(p.email || '').trim(),
    website:    String(p.website || '').trim(),
    platforms:  String(p.platforms || '').trim(),
    painSignal: String(p.painSignal || '').trim(),
    tier:       String(p.tier || '').trim(),
    score:      p.score,
    source:     String(p.source || 'Manual'),
    notes:      String(p.notes || '').trim()
  };
  if (!prospect.business) throw new Error('Business name is required.');
  if (!prospect.email && !prospect.phone) throw new Error('Add at least an email or a phone number.');

  var known = findKnown(buildKnownIndex(ss), prospect);
  if (known) {
    if (known.kind === 'contractor') {
      return { status: 'error', message: prospect.business + ' matches an existing contractor/trial on your Contractors tab — not added.' };
    }
    return { status: 'error', message: prospect.business + ' is already on the Prospects tab (row ' + known.row + ').' };
  }

  appendProspectRow(sheet, prospect);
  return { status: 'success', added: prospect.business };
}

function appendProspectRow(sheet, pr) {
  sheet.appendRow([
    new Date().toLocaleString(),
    pr.business, pr.firstName || '', pr.lastName || '', pr.city || '', pr.zip || '',
    pr.phone || '', pr.email || '', pr.website || '', pr.platforms || '',
    pr.painSignal || '', pr.tier || defaultTier(pr.platforms),
    (pr.score === '' || pr.score === undefined || pr.score === null || isNaN(Number(pr.score))) ? '' : Number(pr.score),
    pr.source || '', 'New', 0, '', '', pr.notes || ''
  ]);
}

function apiUpdateProspect(ss, p) {
  var sheet = ensureProspectsSheet(ss);
  var row = requireProspectRow(sheet, p);

  // Only contact/identity fields are editable — status and stage move
  // through their own actions so the sequence can't be corrupted.
  var editable = { firstName: 3, lastName: 4, city: 5, zip: 6, phone: 7, email: 8, website: 9, tier: 12, notes: 19 };
  var changed = [];
  for (var field in editable) {
    if (p[field] !== undefined) {
      sheet.getRange(row, editable[field]).setValue(String(p[field]).trim());
      changed.push(field);
    }
  }
  return { status: 'success', row: row, changed: changed };
}

function apiSetProspectStatus(ss, p) {
  var sheet = ensureProspectsSheet(ss);
  var row = requireProspectRow(sheet, p);
  if (PROSPECT_STATUSES.indexOf(p.prospectStatus) === -1) throw new Error('Invalid prospect status.');

  sheet.getRange(row, 15).setValue(p.prospectStatus);
  if (p.prospectStatus === 'Opted Out') sheet.getRange(row, 17).setValue('');   // clear any pending touch
  return { status: 'success', row: row, prospectStatus: p.prospectStatus };
}

function requireProspectRow(sheet, p) {
  var row = parseInt(p.row, 10);
  if (isNaN(row) || row < 2 || row > sheet.getLastRow()) throw new Error('Invalid prospect row.');
  return row;
}

// The send. Uses the edited subject/body from prospects.html when
// provided, otherwise the generated draft. Never called by a trigger —
// only by you pressing Send.
function apiSendProspectTouch(ss, p) {
  var sheet = ensureProspectsSheet(ss);
  var row = requireProspectRow(sheet, p);
  var prospect = readProspect(sheet, row);

  if (prospect.status === 'Opted Out') throw new Error(prospect.business + ' has opted out — nothing can be sent.');
  if (!prospectIsSendable(prospect))   throw new Error('This prospect is not in a sendable state (' + prospect.status + ').');

  var draft = draftTouch(prospect);
  if (!draft) throw new Error('Sequence already complete for ' + prospect.business + '.');

  var subject = String(p.subject !== undefined ? p.subject : draft.subject || '');
  var body    = String(p.body    !== undefined ? p.body    : draft.body    || '');
  if (!body.trim()) throw new Error('Message body is empty.');

  var sentTo = '';
  if (draft.channel === 'email') {
    if (!prospect.email) throw new Error('No email on file for ' + prospect.business + ' — add one first.');
    if (!subject.trim()) throw new Error('Email subject is empty.');
    // CAN-SPAM floor: identity + postal address + opt-out on every email,
    // even if the footer was edited out.
    if (body.indexOf(OUTREACH_SITE) === -1 || body.toLowerCase().indexOf('no thanks') === -1) {
      body += emailFooter();
    }
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Gmail daily send quota is used up — try again after it resets.');
    MailApp.sendEmail(prospect.email, subject, body);
    sentTo = prospect.email;

  } else {  // sms
    if (!prospect.phone) throw new Error('No phone on file for ' + prospect.business + ' — add one first.');
    if (!getProperty('TWILIO_SID')) throw new Error('Twilio is not configured (TWILIO_SID missing) — SMS cannot be sent.');
    if (!smsWindowOpen()) {
      throw new Error('Outside the texting window (Mon–Sat ' + SMS_HOURS.start + 'am–' + (SMS_HOURS.end - 12) +
                      'pm Central). Send the text during business hours.');
    }
    // TCPA floor: first-ever text must carry the STOP opt-out.
    if (!prospectHasPriorSms(ss, row) && body.toUpperCase().indexOf('STOP') === -1) {
      body += ' Reply STOP to opt out.';
    }
    sendSMS(prospect.phone, body);
    sentTo = prospect.phone;
  }

  logOutreach(ss, prospect, draft, sentTo, subject, body, 'Sent');
  advanceProspect(sheet, row, prospect);
  return { status: 'success', row: row, channel: draft.channel, touch: draft.touch, sentTo: sentTo };
}

function apiSkipProspectTouch(ss, p) {
  var sheet = ensureProspectsSheet(ss);
  var row = requireProspectRow(sheet, p);
  var prospect = readProspect(sheet, row);

  var draft = draftTouch(prospect);
  if (!draft) throw new Error('Sequence already complete for ' + prospect.business + '.');

  logOutreach(ss, prospect, draft, '', '', '', 'Skipped');
  advanceProspect(sheet, row, prospect);
  return { status: 'success', row: row, skipped: draft.touch };
}

function advanceProspect(sheet, row, prospect) {
  var newStage = prospect.stage + 1;
  var done = newStage >= PROSPECT_SEQUENCE.length;
  sheet.getRange(row, 15).setValue(done ? 'Sequence Done' : 'In Sequence');   // Status
  sheet.getRange(row, 16).setValue(newStage);                                 // Stage
  if (done) {
    sheet.getRange(row, 17).setValue('');
  } else {
    var next = new Date(Date.now() + PROSPECT_SEQUENCE[newStage].gap * 24 * 3600 * 1000);
    sheet.getRange(row, 17).setValue(next.toLocaleDateString());              // Next Touch
  }
  sheet.getRange(row, 18).setValue(new Date().toLocaleString());              // Last Touch
}

function prospectHasPriorSms(ss, prospectRow) {
  var log = ss.getSheetByName('Outreach Log');
  if (!log || log.getLastRow() < 2) return false;
  var rows = log.getRange(2, 2, log.getLastRow() - 1, 4).getValues();  // Prospect Row .. Channel
  for (var i = 0; i < rows.length; i++) {
    if (parseInt(rows[i][0], 10) === prospectRow && String(rows[i][3]).toLowerCase() === 'sms') return true;
  }
  return false;
}

function logOutreach(ss, prospect, draft, sentTo, subject, body, result) {
  ensureOutreachLogSheet(ss).appendRow([
    new Date().toLocaleString(),
    prospect.row,
    prospect.business,
    (prospect.firstName + ' ' + prospect.lastName).trim(),
    draft.channel,
    draft.touch,
    sentTo,
    subject,
    body,
    result
  ]);
}

// ── Bulk import (doPost, used by scraper/ and CSV pushes) ────
// POST body: { type: 'ProspectImport', key: <DASHBOARD_KEY>,
//              source: 'scraper 2026-08-23', prospects: [ {...}, ... ] }
// The forms endpoint is public by design, so this write path carries
// its own key check — an unauthenticated POST cannot fill your
// pipeline with junk.
function handleProspectImport(ss, data) {
  var key = getProperty('DASHBOARD_KEY');
  if (!key) return { status: 'error', message: 'DASHBOARD_KEY is not set in Script Properties.' };
  if (data.key !== key) return { status: 'error', message: 'Invalid key.' };

  var list = data.prospects;
  if (!list || !list.length) return { status: 'error', message: 'No prospects in payload.' };
  if (list.length > 200) return { status: 'error', message: 'Max 200 prospects per import — split the batch.' };

  var sheet = ensureProspectsSheet(ss);
  var idx = buildKnownIndex(ss);
  var added = 0, merged = 0, skippedContractors = 0, errors = [];

  list.forEach(function(raw) {
    try {
      var pr = {
        business:   String(raw.business || '').trim(),
        firstName:  String(raw.firstName || '').trim(),
        lastName:   String(raw.lastName || '').trim(),
        city:       String(raw.city || '').trim(),
        zip:        String(raw.zip || '').trim(),
        phone:      String(raw.phone || '').trim(),
        email:      String(raw.email || '').trim(),
        website:    String(raw.website || '').trim(),
        platforms:  String(raw.platforms || '').trim(),
        painSignal: String(raw.painSignal || '').trim(),
        tier:       String(raw.tier || '').trim(),
        score:      raw.score,
        source:     String(raw.source || data.source || 'Import'),
        notes:      String(raw.notes || '').trim()
      };
      if (!pr.business) { errors.push('(row with no business name skipped)'); return; }

      var known = findKnown(idx, pr);
      if (known && known.kind === 'contractor') { skippedContractors++; return; }

      if (known && known.kind === 'prospect') {
        mergeProspect(sheet, known.row, pr);
        merged++;
        return;
      }

      appendProspectRow(sheet, pr);
      var newRow = sheet.getLastRow();
      var b = normBiz(pr.business), e = normEmail(pr.email), ph = normPhoneKey(pr.phone);
      if (b)  idx.biz[b]    = { kind: 'prospect', row: newRow };
      if (e)  idx.email[e]  = { kind: 'prospect', row: newRow };
      if (ph) idx.phone[ph] = { kind: 'prospect', row: newRow };
      added++;
    } catch (err) {
      errors.push(String(err.message || err));
    }
  });

  return {
    status: 'success',
    added: added,
    merged: merged,
    skippedExistingContractors: skippedContractors,
    errors: errors
  };
}

// A re-scraped prospect isn't a duplicate to throw away — it's new
// signal. Union the platforms (being on MORE platforms is the
// strongest Hot signal), fill any blank contact fields, and upgrade
// the tier if the new evidence is warmer. Never touches status,
// stage, or the touch schedule.
function mergeProspect(sheet, row, incoming) {
  var existing = readProspect(sheet, row);

  var have = existing.platforms.split(',').map(function(s) { return s.trim(); }).filter(String);
  var haveLower = have.map(function(s) { return s.toLowerCase(); });
  incoming.platforms.split(',').map(function(s) { return s.trim(); }).filter(String).forEach(function(pl) {
    if (haveLower.indexOf(pl.toLowerCase()) === -1) { have.push(pl); haveLower.push(pl.toLowerCase()); }
  });
  sheet.getRange(row, 10).setValue(have.join(', '));

  var fill = { firstName: 3, lastName: 4, city: 5, zip: 6, phone: 7, email: 8, website: 9 };
  for (var f in fill) {
    if (!existing[f] && incoming[f]) sheet.getRange(row, fill[f]).setValue(incoming[f]);
  }

  if (incoming.painSignal && existing.painSignal.indexOf(incoming.painSignal) === -1) {
    sheet.getRange(row, 11).setValue(existing.painSignal ? existing.painSignal + ' | ' + incoming.painSignal : incoming.painSignal);
  }

  var rank = { Cool: 0, Warm: 1, Hot: 2 };
  var newTier = incoming.tier || defaultTier(have.join(','));
  if ((rank[newTier] || 0) > (rank[existing.tier] || 0)) sheet.getRange(row, 12).setValue(newTier);
  if (incoming.score !== undefined && incoming.score !== '' && !isNaN(Number(incoming.score)) &&
      (existing.score === '' || Number(incoming.score) > Number(existing.score))) {
    sheet.getRange(row, 13).setValue(Number(incoming.score));
  }
}

// ── Daily digest (optional) ──────────────────────────────────
// Emails you each morning with who's due for a touch. It REMINDS —
// it never sends outreach by itself. Run installProspectTriggers()
// once from the editor to turn it on.
function sendProspectDigest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Prospects');
  if (!sheet || sheet.getLastRow() < 2) return;

  var now = new Date();
  var due = [];
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 19).getValues().forEach(function(r, i) {
    var p = prospectFromRow(r, i + 2);
    if (prospectIsDue(p, now)) due.push(p);
  });
  if (!due.length) return;   // quiet day — no email

  var lines = due.slice(0, 30).map(function(p) {
    var step = PROSPECT_SEQUENCE[p.stage];
    return '• ' + p.business + ' (' + (p.city || '?') + ', ' + (p.tier || 'Warm') + ') — touch ' +
           (p.stage + 1) + ' of ' + PROSPECT_SEQUENCE.length + ' [' + step.channel.toUpperCase() + ']: ' + step.label;
  });
  if (due.length > 30) lines.push('…and ' + (due.length - 30) + ' more.');

  MailApp.sendEmail(ADMIN_EMAIL,
    'Outreach due today: ' + due.length + ' prospect' + (due.length === 1 ? '' : 's'),
    due.length + ' prospect(s) are due for their next touch:\n\n' + lines.join('\n') +
    '\n\nOpen the outreach center to review the drafts and send:\n' +
    'https://' + OUTREACH_SITE + '/prospects.html\n\n' +
    'Nothing sends without you — every message waits for your approval there.'
  );
}

function installProspectTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendProspectDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendProspectDigest').timeBased().everyDays(1).atHour(8).create();
  Logger.log('Trigger installed: sendProspectDigest (daily @ 8am). It only emails YOU a reminder — outreach still requires pressing Send in prospects.html.');
}

// ── Test helpers ─────────────────────────────────────────────

// Adds three sample prospects so you can try prospects.html end-to-end
// before the scraper has run. Safe: clearly-fake contact details.
function testSeedProspects() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = handleProspectImport(ss, {
    key: getProperty('DASHBOARD_KEY'),
    source: 'Test Seed',
    prospects: [
      { business: 'Sample Air Co (TEST)', firstName: 'Sam', lastName: 'Ple', city: 'San Antonio', zip: '78209',
        phone: '2105550100', email: ADMIN_EMAIL, platforms: 'Thumbtack, Angi',
        painSignal: 'Top Pro badge; review mentions lead costs', tier: 'Hot', score: 9 },
      { business: 'Demo Heating & Cooling (TEST)', firstName: 'Dee', lastName: 'Mo', city: 'San Antonio', zip: '78230',
        phone: '2105550101', email: ADMIN_EMAIL, platforms: 'Angi', painSignal: 'Angi Certified badge', tier: 'Warm', score: 5 },
      { business: 'Placeholder Climate LLC (TEST)', city: 'Schertz', zip: '78154',
        phone: '2105550102', email: '', platforms: 'Thumbtack', painSignal: '', tier: 'Warm', score: 4 }
    ]
  });
  Logger.log('testSeedProspects: ' + JSON.stringify(result));
  Logger.log('Open prospects.html, connect with your DASHBOARD_KEY, and the three TEST rows will be in the queue. ' +
             'Their email is your ADMIN_EMAIL, so pressing Send emails you, not a real contractor.');
}

// Logs the full 4-touch drafted sequence for a sample Thumbtack
// prospect. Writes nothing, sends nothing.
function testDraftSequence() {
  var sample = {
    row: 0, business: 'Alamo Comfort Air', firstName: 'Mike', lastName: 'Reyes',
    city: 'San Antonio', zip: '78209', phone: '2105550100', email: 'owner@example.com',
    website: '', platforms: 'Thumbtack, Angi', painSignal: '', tier: 'Hot', score: 9,
    source: '', status: 'New', stage: 0, nextTouch: '', lastTouch: '', notes: ''
  };
  for (var stage = 0; stage < PROSPECT_SEQUENCE.length; stage++) {
    sample.stage = stage;
    var d = draftTouch(sample);
    Logger.log('--- Touch ' + d.touch + ' [' + d.channel.toUpperCase() + '] ' + d.label + ' ---');
    if (d.subject) Logger.log('Subject: ' + d.subject);
    Logger.log(d.body);
  }
}

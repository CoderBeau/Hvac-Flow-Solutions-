#!/usr/bin/env node
// ============================================================
// HVAC Flow Solutions — Contractor Prospect Scraper
//
// Finds HVAC contractors who are VISIBLY PAYING for shared leads
// (Thumbtack, Angi, Yelp ads) — the one group proven to spend money
// on leads — enriches them with owner names and direct contact info
// (BBB, their own websites), scores them Hot/Warm/Cool, and hands
// them to the Prospect Outreach Center (prospects.html) where every
// outreach message waits for your approval.
//
//   node scrape-prospects.js                          # scrape default metro, write out/ files
//   node scrape-prospects.js --push                   # ...and push into the Prospects tab
//   node scrape-prospects.js --metro "Austin, TX"     # different metro
//   node scrape-prospects.js --sources thumbtack,bbb  # subset of sources
//   node scrape-prospects.js --headed                 # watch the browser / pass human-checks
//   node scrape-prospects.js --demo --push            # sample data end-to-end (no scraping)
//   node scrape-prospects.js --from-csv leads.csv --push   # push hand-collected rows
//
// Ground rules (also in README.md):
//   • Public pages only — nothing behind a login, no captcha busting.
//     If a site shows a block page, the source is skipped and you
//     collect those few by hand instead.
//   • Polite pace — one page at a time with multi-second delays.
//     Keep --limit modest; you need 20 good prospects, not 2,000.
//   • The scraper only FILLS THE PIPELINE. It never sends outreach —
//     sending stays behind your Send button in prospects.html.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { scoreProspect } = require('./lib/score');
const { enrichFromWebsite, formatPhone, normalizePhone } = require('./lib/extract');

const SOURCES = {
  thumbtack: require('./sources/thumbtack'),
  angi: require('./sources/angi'),
  yelp: require('./sources/yelp'),
  bbb: require('./sources/bbb')
};

// Shared-lead platforms count toward the multi-platform Hot signal.
// BBB is an enrichment source (owner names, accreditation), not a
// lead vendor — it contributes contact info, not a platform tag.
const LEAD_PLATFORMS = ['Thumbtack', 'Angi', 'HomeAdvisor', 'Networx', 'Modernize', 'Yelp Ads'];

// ── CLI args ─────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    metros: [], sources: Object.keys(SOURCES), limit: 15, delay: 4000,
    out: '', push: false, headed: false, demo: false, fromCsv: '', enrich: true
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--metro') args.metros.push(argv[++i]);
    else if (a === '--sources') args.sources = argv[++i].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10) || 15;
    else if (a === '--delay') args.delay = parseInt(argv[++i], 10) || 4000;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--push') args.push = true;
    else if (a === '--headed') args.headed = true;
    else if (a === '--demo') args.demo = true;
    else if (a === '--no-enrich') args.enrich = false;
    else if (a === '--from-csv') args.fromCsv = argv[++i];
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error(`Unknown flag: ${a}`); usage(); process.exit(1); }
  }
  if (!args.metros.length) args.metros = ['San Antonio, TX'];
  for (const s of args.sources) {
    if (!SOURCES[s]) { console.error(`Unknown source "${s}". Available: ${Object.keys(SOURCES).join(', ')}`); process.exit(1); }
  }
  return args;
}

function usage() {
  console.log(`Usage: node scrape-prospects.js [options]
  --metro "City, ST"     Metro to scan (repeatable). Default: "San Antonio, TX"
  --sources a,b,c        Sources to use: ${Object.keys(SOURCES).join(', ')} (default: all)
  --limit N              Max profiles per source per metro (default 15 — keep it modest)
  --delay MS             Base delay between page loads (default 4000)
  --out FILE             Output file prefix (default out/prospects-<date>)
  --push                 Push results into the Prospects tab (needs exec URL + key, see README)
  --headed               Show the browser window (lets you pass any human-check yourself)
  --no-enrich            Skip visiting contractor websites for emails/owner names
  --demo                 Use built-in sample data instead of scraping (test the pipeline)
  --from-csv FILE        Skip scraping; load hand-collected prospects from a CSV`);
}

function parseMetro(m) {
  const [city, state] = String(m).split(',').map((s) => s.trim());
  if (!city || !state) { console.error(`Metro must look like "San Antonio, TX" (got "${m}")`); process.exit(1); }
  return {
    city, state: state.toUpperCase(),
    citySlug: city.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    stateSlug: state.toLowerCase()
  };
}

// ── Merge & score ────────────────────────────────────────────
const normBiz = (s) => String(s || '').toLowerCase().replace(/\b(llc|inc|co|corp|ltd|company|services?|heating|cooling|air|conditioning|hvac|the|and|&)\b/g, '').replace(/[^a-z0-9]/g, '');

function mergeAndScore(partials, sourceLabel) {
  const byKey = new Map();

  for (const p of partials) {
    const key = normBiz(p.business);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, {
        business: p.business, firstName: '', lastName: '', city: p.city || '', zip: '',
        phone: '', email: '', website: '', platforms: [], signals: [], reviewCount: 0,
        profileUrls: [], notes: []
      });
    }
    const m = byKey.get(key);
    if (LEAD_PLATFORMS.includes(p.platform) && !m.platforms.includes(p.platform)) m.platforms.push(p.platform);
    if (!m.firstName && p.firstName) { m.firstName = p.firstName; m.lastName = p.lastName || ''; }
    if (!m.city && p.city) m.city = p.city;
    if (!m.zip && p.zip) m.zip = p.zip;
    if (!m.phone && p.phone) m.phone = p.phone;
    if (!m.email && p.email) m.email = p.email;
    if (!m.website && p.website) m.website = p.website;
    m.signals.push(...(p.signals || []));
    m.reviewCount = Math.max(m.reviewCount, p.reviewCount || 0);
    if (p.profileUrl) m.profileUrls.push(p.profileUrl);
    if (p.yearsInBusiness) m.notes.push(`${p.yearsInBusiness} yrs in business`);
  }

  const merged = [];
  for (const m of byKey.values()) {
    const { score, tier, painSignal } = scoreProspect({
      platforms: m.platforms,
      signals: m.signals,
      reviewCount: m.reviewCount,
      hasOwner: !!m.firstName,
      hasEmail: !!m.email
    });
    merged.push({
      business: m.business,
      firstName: m.firstName, lastName: m.lastName,
      city: m.city, zip: m.zip,
      phone: m.phone, email: m.email, website: m.website,
      platforms: m.platforms.join(', '),
      painSignal: painSignal,
      tier, score,
      source: sourceLabel,
      notes: [...new Set(m.notes)].concat(m.profileUrls.slice(0, 2)).join(' | ')
    });
  }
  merged.sort((a, b) => b.score - a.score);
  return merged;
}

// ── Output ───────────────────────────────────────────────────
const CSV_FIELDS = ['business', 'firstName', 'lastName', 'city', 'zip', 'phone', 'email', 'website', 'platforms', 'painSignal', 'tier', 'score', 'source', 'notes'];

function toCsv(rows) {
  const escape = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [CSV_FIELDS.join(',')]
    .concat(rows.map((r) => CSV_FIELDS.map((f) => escape(r[f])).join(',')))
    .join('\n') + '\n';
}

// Minimal quoted-field CSV reader for --from-csv (headers must use
// the same field names as our CSV output; extra columns are ignored).
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushField(); pushRow(); }
    else field += c;
  }
  if (field !== '' || row.length) { pushField(); pushRow(); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

function writeOutputs(prospects, outPrefix) {
  const dir = path.dirname(outPrefix);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPrefix + '.json', JSON.stringify(prospects, null, 2));
  fs.writeFileSync(outPrefix + '.csv', toCsv(prospects));
  console.log(`\nWrote ${prospects.length} prospect(s) to:\n  ${outPrefix}.json\n  ${outPrefix}.csv`);
}

// ── Push to the Prospects tab ────────────────────────────────
function pushConfig() {
  let execUrl = process.env.HFS_EXEC_URL || '';
  let key = process.env.HFS_DASHBOARD_KEY || '';
  const cfgPath = path.join(__dirname, 'config.json');
  if ((!execUrl || !key) && fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      execUrl = execUrl || cfg.execUrl || '';
      key = key || cfg.dashboardKey || '';
    } catch { /* fall through to the error below */ }
  }
  if (!execUrl || !key) {
    console.error('\nTo push, set HFS_EXEC_URL + HFS_DASHBOARD_KEY env vars, or copy config.example.json to config.json and fill it in.');
    process.exit(1);
  }
  return { execUrl, key };
}

async function pushProspects(prospects, sourceLabel) {
  const { execUrl, key } = pushConfig();
  let added = 0, mergedCount = 0, skipped = 0;

  for (let i = 0; i < prospects.length; i += 100) {
    const batch = prospects.slice(i, i + 100);
    const res = await fetch(execUrl, {
      method: 'POST',
      redirect: 'follow',   // Apps Script answers POST with a 302 to the JSON result
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ type: 'ProspectImport', key, source: sourceLabel, prospects: batch })
    });
    const data = await res.json().catch(() => null);
    if (!data || data.status !== 'success') {
      throw new Error('Import failed: ' + (data && data.message ? data.message : `HTTP ${res.status}`));
    }
    added += data.added || 0;
    mergedCount += data.merged || 0;
    skipped += data.skippedExistingContractors || 0;
    if (data.errors && data.errors.length) console.log('  Import warnings:', data.errors.join('; '));
  }
  console.log(`\nPushed to the Prospects tab: ${added} added, ${mergedCount} merged into existing prospects, ${skipped} skipped (already your contractors).`);
  console.log('Open prospects.html — the new prospects are in the send queue with drafts waiting for your approval.');
}

// ── Demo data (pipeline test, no scraping) ───────────────────
function demoProspects(metro) {
  const mk = (business, first, last, zip, phone, platforms, signals, reviews) => ({
    business, firstName: first, lastName: last, city: metro.city, zip,
    phone, email: '', website: '', platform: '', platforms: '', signals, reviewCount: reviews,
    profileUrl: '', _platforms: platforms
  });
  const raw = [
    mk('Sample Comfort Air (SAMPLE)', 'Ray', 'Delgado', '78209', '(210) 555-0181', ['Thumbtack', 'Angi'], ['top pro'], 47),
    mk('Example Climate Pros (SAMPLE)', 'Tina', 'Villarreal', '78230', '(210) 555-0182', ['Angi'], ['angi certified'], 23),
    mk('Placeholder Cooling LLC (SAMPLE)', '', '', '78154', '(210) 555-0183', ['Thumbtack'], [], 6),
    mk('Fictional Air Services (SAMPLE)', 'Walt', 'Nguyen', '78023', '(210) 555-0184', ['Thumbtack', 'Yelp Ads'], ['sponsored', 'owner-operated (sole proprietor)'], 31),
    mk('Notreal Heating & Air (SAMPLE)', '', '', '78247', '(210) 555-0185', ['Yelp Ads'], [], 12)
  ];
  // expand each into one partial per platform so merge/scoring runs for real
  const partials = [];
  for (const r of raw) {
    for (const pl of r._platforms) partials.push({ ...r, platform: pl });
  }
  return partials;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const stamp = new Date().toISOString().slice(0, 10);
  const sourceLabel = args.demo ? `demo ${stamp}` : args.fromCsv ? `csv ${stamp}` : `scraper ${stamp}`;
  const outPrefix = args.out || path.join(__dirname, 'out', `prospects-${stamp}`);
  const log = (msg) => console.log(msg);

  let prospects;

  if (args.fromCsv) {
    const rows = parseCsv(fs.readFileSync(args.fromCsv, 'utf8'));
    prospects = rows
      .filter((r) => r.business)
      .map((r) => ({
        business: r.business, firstName: r.firstName || '', lastName: r.lastName || '',
        city: r.city || '', zip: r.zip || '', phone: r.phone || '', email: r.email || '',
        website: r.website || '', platforms: r.platforms || '', painSignal: r.painSignal || '',
        tier: r.tier || '', score: r.score || '', source: r.source || sourceLabel, notes: r.notes || ''
      }));
    console.log(`Loaded ${prospects.length} prospect(s) from ${args.fromCsv}.`);

  } else {
    let partials = [];

    if (args.demo) {
      console.log('DEMO MODE — using built-in sample contractors (no scraping, all data fictional).');
      for (const m of args.metros) partials.push(...demoProspects(parseMetro(m)));
    } else {
      let chromium;
      try {
        ({ chromium } = require('playwright'));
      } catch {
        console.error('Playwright is not installed. Run:  cd scraper && npm install');
        process.exit(1);
      }
      // CHROMIUM_PATH lets environments with a system-installed Chromium
      // (e.g. remote sandboxes) skip Playwright's own browser download.
      const launchOpts = { headless: !args.headed };
      if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
      const browser = await chromium.launch(launchOpts);
      const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        locale: 'en-US'
      });

      try {
        for (const metroStr of args.metros) {
          const metro = parseMetro(metroStr);
          console.log(`\nScanning ${metro.city}, ${metro.state} — sources: ${args.sources.join(', ')}`);
          for (const s of args.sources) {
            const found = await SOURCES[s].search({ context, metro, limit: args.limit, delay: args.delay, log });
            partials.push(...found);
          }
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }

    prospects = mergeAndScore(partials, sourceLabel);

    // Enrichment: visit each contractor's own website for a direct
    // email + owner name (that's usually where they live), then rescore.
    if (args.enrich && !args.demo) {
      const withSites = prospects.filter((p) => p.website);
      if (withSites.length) console.log(`\nEnriching ${withSites.length} prospect(s) from their own websites...`);
      for (const p of withSites) {
        const extra = await enrichFromWebsite(p.website, log);
        let gained = 0;   // same weights as the rubric in lib/score.js
        if (!p.email && extra.emails.length) { p.email = extra.emails[0]; gained += 1; }
        if (!p.phone && extra.phones.length) p.phone = formatPhone(normalizePhone(extra.phones[0]));
        if (!p.firstName && extra.owner) {
          p.firstName = extra.owner.firstName;
          p.lastName = extra.owner.lastName;
          gained += 1;
        }
        if (gained) {
          p.score += gained;
          p.tier = p.score >= 5 ? 'Hot' : p.score >= 2 ? 'Warm' : 'Cool';
        }
      }
    }

    // Drop rows with no way to reach anyone — the outreach center
    // can't use a prospect with neither email nor phone.
    const reachable = prospects.filter((p) => p.email || p.phone);
    const dropped = prospects.length - reachable.length;
    if (dropped) console.log(`\nDropped ${dropped} prospect(s) with no phone or email (nothing to outreach with).`);
    prospects = reachable;
  }

  if (!prospects.length) {
    console.log('\nNo prospects collected. If sources showed block pages, try --headed, a smaller --limit, or collect a few by hand and use --from-csv.');
    process.exit(0);
  }

  const tally = { Hot: 0, Warm: 0, Cool: 0 };
  prospects.forEach((p) => { tally[p.tier] = (tally[p.tier] || 0) + 1; });
  console.log(`\nPipeline: ${prospects.length} prospect(s) — ${tally.Hot || 0} Hot, ${tally.Warm || 0} Warm, ${tally.Cool || 0} Cool.`);

  writeOutputs(prospects, outPrefix);

  if (args.push) {
    await pushProspects(prospects, sourceLabel);
  } else {
    console.log('\nDry run (nothing pushed). Re-run with --push to load these into the Prospects tab,');
    console.log('or open the CSV, prune it, and push the edited file with --from-csv.');
  }
}

main().catch((err) => {
  console.error('\nFatal: ' + err.message);
  process.exit(1);
});

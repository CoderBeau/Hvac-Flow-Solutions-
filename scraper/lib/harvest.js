// Shared listing-page -> profile-page harvest loop used by every
// source adapter. Adapters only supply the search URL and a filter
// for what a profile link looks like; everything else (lazy-load
// scrolling, JSON-LD extraction, badge detection, politeness delays,
// block detection) lives here once.
'use strict';

const {
  jsonLdObjects, businessFromJsonLd, pageText, hrefsMatching,
  phonesFromText, ownerFromText, formatPhone
} = require('./extract');
const { detectPaidSignals } = require('./score');

const BLOCK_MARKERS = [
  'access denied', 'unusual traffic', 'are you a human', 'verify you are human',
  'just a moment', 'attention required', 'px-captcha', 'perimeterx',
  'request blocked', 'pardon our interruption'
];

function looksBlocked(text, title) {
  const t = (String(title || '') + ' ' + String(text || '').slice(0, 600)).toLowerCase();
  return BLOCK_MARKERS.some((m) => t.includes(m));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * ms * 0.5);

async function politeGoto(page, url, delay) {
  await sleep(jitter(delay));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1500);
}

async function lazyScroll(page, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2)).catch(() => {});
    await sleep(1200);
  }
}

/**
 * @param {object} opts
 * @param {import('playwright').BrowserContext} opts.context
 * @param {string}   opts.platform    e.g. 'Thumbtack'
 * @param {string}   opts.searchUrl   public listing/search page
 * @param {function} opts.linkFilter  (href) => boolean — is this a profile link?
 * @param {object}   opts.metro       { city, state }
 * @param {number}   opts.limit       max profiles to visit
 * @param {number}   opts.delay       base ms between page loads
 * @param {function} opts.log
 * @param {function} [opts.extractExtra]  async (page, prospect) — adapter-specific additions
 */
async function harvestProfiles(opts) {
  const { context, platform, searchUrl, linkFilter, metro, limit, delay, log, extractExtra } = opts;
  const page = await context.newPage();
  const results = [];

  try {
    log(`  ${platform}: opening ${searchUrl}`);
    await politeGoto(page, searchUrl, delay);

    let text = await pageText(page);
    if (looksBlocked(text, await page.title())) {
      log(`  ${platform}: the site is showing a block/human-check page. Re-run with --headed and pass the check yourself, or collect these by hand (see README). Skipping source.`);
      return results;
    }

    await lazyScroll(page);
    const links = (await hrefsMatching(page, linkFilter)).slice(0, limit);
    log(`  ${platform}: found ${links.length} profile link(s), visiting up to ${limit}...`);

    for (const link of links) {
      try {
        await politeGoto(page, link, delay);
        text = await pageText(page);
        if (looksBlocked(text, await page.title())) {
          log(`  ${platform}: blocked mid-run — keeping the ${results.length} collected so far.`);
          break;
        }

        const ld = businessFromJsonLd(await jsonLdObjects(page)) || {};
        const phones = phonesFromText(text);
        const owner = ownerFromText(text);
        const reviewMatch = text.match(/([\d,]+)\s+(?:reviews?|ratings?)/i);

        const prospect = {
          business: ld.business || (await page.title()).split(/[|\-–•]/)[0].trim(),
          firstName: owner ? owner.firstName : '',
          lastName: owner ? owner.lastName : '',
          city: ld.city || metro.city,
          zip: ld.zip || '',
          phone: formatPhone(ld.phone || phones[0] || ''),
          email: ld.email || '',
          website: ld.website || '',
          platform,
          signals: detectPaidSignals(text),
          reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, ''), 10) : 0,
          profileUrl: link
        };

        if (extractExtra) await extractExtra(page, prospect, text);

        if (prospect.business && prospect.business.length > 2) {
          results.push(prospect);
          log(`    + ${prospect.business}${prospect.signals.length ? '  [' + prospect.signals.join(', ') + ']' : ''}`);
        }
      } catch (err) {
        log(`    (profile failed: ${err.message.split('\n')[0]})`);
      }
    }
  } catch (err) {
    log(`  ${platform}: source failed — ${err.message.split('\n')[0]}`);
  } finally {
    await page.close().catch(() => {});
  }
  return results;
}

module.exports = { harvestProfiles, looksBlocked, sleep, jitter };

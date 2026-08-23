// Generic page-extraction helpers.
//
// Directory sites redesign constantly, so the adapters lean on things
// that survive redesigns: schema.org JSON-LD blocks, tel:/mailto:
// links, and plain-text regexes — not deep CSS selector chains.
'use strict';

// Domains that are never a contractor's own website.
const PLATFORM_DOMAINS = [
  'thumbtack.com', 'angi.com', 'angieslist.com', 'homeadvisor.com',
  'networx.com', 'modernize.com', 'yelp.com', 'bbb.org',
  'google.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'youtube.com', 'nextdoor.com', 'pinterest.com',
  'apple.com', 'mapbox.com', 'gstatic.com', 'schema.org'
];

function isPlatformUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return PLATFORM_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return true;
  }
}

// All schema.org objects on the page, @graph flattened.
async function jsonLdObjects(page) {
  const raws = await page
    .$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent))
    .catch(() => []);
  const out = [];
  for (const raw of raws) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const obj of list) {
        if (obj && Array.isArray(obj['@graph'])) out.push(...obj['@graph']);
        else if (obj) out.push(obj);
      }
    } catch {
      /* malformed block — skip */
    }
  }
  return out;
}

const BUSINESS_TYPES = [
  'LocalBusiness', 'HVACBusiness', 'HomeAndConstructionBusiness',
  'ProfessionalService', 'Organization', 'Plumber', 'GeneralContractor'
];

function businessFromJsonLd(objects) {
  for (const obj of objects) {
    const types = [].concat(obj['@type'] || []);
    if (!types.some((t) => BUSINESS_TYPES.includes(t))) continue;
    const addr = obj.address || {};
    return {
      business: str(obj.name),
      phone: normalizePhone(str(obj.telephone)),
      website: !obj.url || isPlatformUrl(str(obj.url)) ? '' : str(obj.url),
      city: str(addr.addressLocality),
      zip: str(addr.postalCode),
      email: str(obj.email).toLowerCase()
    };
  }
  return null;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)/g;

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return d;
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return '';
}

function phonesFromText(text) {
  const found = new Set();
  for (const m of String(text || '').matchAll(PHONE_RE)) {
    found.add(m[1] + m[2] + m[3]);
  }
  return [...found];
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const EMAIL_JUNK = /(example\.|sentry|wixpress|\.png$|\.jpe?g$|\.gif$|\.svg$|\.webp$|noreply|no-reply|godaddy|schema\.org)/i;

function emailsFromHtml(html) {
  const found = new Set();
  for (const m of String(html || '').matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    if (!EMAIL_JUNK.test(email)) found.add(email);
  }
  return [...found];
}

// "Joe Ramos, Owner" / "Principal Contacts: Mr. Joe Ramos" — the
// pattern BBB profiles and small-shop about pages actually use.
function ownerFromText(text) {
  const t = String(text || '');
  let m = t.match(/([A-Z][a-z]+)\s+(?:[A-Z]\.?\s+)?([A-Z][a-z]+)\s*,\s*(?:Owner|President|Principal|Founder|Managing Member|CEO)/);
  if (m) return { firstName: m[1], lastName: m[2] };
  m = t.match(/Principal Contacts?[^A-Z]{0,40}(?:Mr\.?|Ms\.?|Mrs\.?)?\s*([A-Z][a-z]+)\s+(?:[A-Z]\.?\s+)?([A-Z][a-z]+)/);
  if (m) return { firstName: m[1], lastName: m[2] };
  return null;
}

// Whole visible text of the page (for badge + phone regexes).
async function pageText(page) {
  return page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
}

// Absolute hrefs on the page matching a predicate.
async function hrefsMatching(page, predicate) {
  const hrefs = await page
    .$$eval('a[href]', (as) => as.map((a) => a.href))
    .catch(() => []);
  const seen = new Set();
  const out = [];
  for (const h of hrefs) {
    const clean = h.split('#')[0];
    if (!seen.has(clean) && predicate(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

// Visit the contractor's own website (home + /contact) with plain
// fetch and pull email / phone / owner name. Their own site is where
// a direct email usually lives.
async function enrichFromWebsite(website, log) {
  const result = { emails: [], phones: [], owner: null };
  if (!website) return result;

  const pages = [website];
  try {
    pages.push(new URL('/contact', website).href);
  } catch {
    return result;
  }

  for (const url of pages) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; HFS-prospector/1.0)' }
      });
      if (!res.ok) continue;
      const html = await res.text();
      result.emails.push(...emailsFromHtml(html));
      const text = html.replace(/<[^>]+>/g, ' ');
      result.phones.push(...phonesFromText(text));
      if (!result.owner) result.owner = ownerFromText(text);
    } catch (err) {
      log && log(`    (website ${url} unreachable: ${err.name || err.message})`);
    }
  }
  result.emails = [...new Set(result.emails)];
  result.phones = [...new Set(result.phones)];
  return result;
}

function formatPhone(d) {
  return d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d || '';
}

module.exports = {
  PLATFORM_DOMAINS,
  isPlatformUrl,
  jsonLdObjects,
  businessFromJsonLd,
  normalizePhone,
  phonesFromText,
  emailsFromHtml,
  ownerFromText,
  pageText,
  hrefsMatching,
  enrichFromWebsite,
  formatPhone
};

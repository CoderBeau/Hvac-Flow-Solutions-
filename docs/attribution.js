/* HVAC Flow Solutions — lead attribution
 *
 * Captures the campaign context of a visit and keeps it available until the
 * visitor actually submits a form, however many pages later that happens.
 *
 * Why this exists: Google Ads reports cost per *conversion*. The Get Quotes
 * tab knows which leads scored Good and which scored Bad. Joining the two
 * needs the campaign, and above all the search term, to survive the trip from
 * ad click to sheet row. Without it, spend can only be judged on Google's
 * numbers, which count junk form fills as wins.
 *
 * Model: last non-direct touch, 30-day window (matches the Google Ads default
 * click lookback). A visit carrying campaign parameters replaces what's
 * stored; direct visits and internal navigation never clear it. So someone who
 * arrives from an ad, leaves, and converts three days later still credits the
 * ad — while someone who arrives from an ad today and a different ad tomorrow
 * credits the one that actually brought them back.
 *
 * Storage is localStorage on boosthvacleads.com, so every page — and any
 * same-origin iframe — reads the same record. No cookies, no third parties,
 * nothing shared off-site.
 *
 * Usage:
 *   <script src="/attribution.js"></script>
 *   var a = window.HFSAttribution.get();
 *   // { leadSource, source, medium, campaign, term, content,
 *   //   clickId, landingPage, referrer, firstSeen }
 */
(function (w, d) {
  'use strict';

  var KEY    = 'hfs_attr';
  var TTL_MS = 30 * 24 * 60 * 60 * 1000;

  var UTM_KEYS   = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid'];

  // Search engines that send organic traffic. Anything else with a referrer
  // is recorded as a plain referral under its own hostname.
  var ENGINES = [
    [/(^|\.)google\./,     'google'],
    [/(^|\.)bing\./,       'bing'],
    [/(^|\.)duckduckgo\./, 'duckduckgo'],
    [/(^|\.)yahoo\./,      'yahoo'],
    [/(^|\.)ecosia\./,     'ecosia'],
    [/(^|\.)brave\./,      'brave']
  ];

  function readStore() {
    try {
      var raw = w.localStorage.getItem(KEY);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || !rec.ts) return null;
      if (Date.now() - rec.ts > TTL_MS) return null;
      return rec;
    } catch (e) {
      return null;              // private browsing, storage disabled, bad JSON
    }
  }

  function writeStore(rec) {
    try { w.localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) {}
  }

  function ownHost() {
    return String(w.location.hostname || '').replace(/^www\./, '');
  }

  function referrerHost() {
    var ref = d.referrer || '';
    if (!ref) return '';
    try {
      return new URL(ref).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  // Reads campaign context out of the current URL. Returns null when the URL
  // carries nothing — that's a direct hit or internal navigation, which must
  // not overwrite an earlier ad click.
  function fromUrl() {
    var params;
    try {
      params = new URLSearchParams(w.location.search);
    } catch (e) {
      return null;
    }

    var found = {}, hasAny = false, i;

    for (i = 0; i < UTM_KEYS.length; i++) {
      var v = params.get(UTM_KEYS[i]);
      if (v) { found[UTM_KEYS[i].replace('utm_', '')] = v; hasAny = true; }
    }

    for (i = 0; i < CLICK_KEYS.length; i++) {
      var c = params.get(CLICK_KEYS[i]);
      if (c) { found.clickId = c; found.clickIdType = CLICK_KEYS[i]; hasAny = true; break; }
    }

    if (!hasAny) return null;

    // A gclid with no utm_source still came from Google Ads — the tracking
    // template may be missing, or a redirect ate the UTMs. Don't lose it.
    if (!found.source && found.clickIdType === 'gclid')   { found.source = 'google';    found.medium = found.medium || 'cpc'; }
    if (!found.source && found.clickIdType === 'msclkid') { found.source = 'bing';      found.medium = found.medium || 'cpc'; }
    if (!found.source && found.clickIdType === 'fbclid')  { found.source = 'facebook';  found.medium = found.medium || 'paid_social'; }

    return found;
  }

  // Fallback when the URL is bare: classify by referrer. Internal referrers
  // return null so browsing the site never counts as a new touch.
  function fromReferrer() {
    var host = referrerHost();
    if (!host) return { source: 'Direct', medium: 'none' };
    if (host === ownHost() || host.indexOf('.' + ownHost()) > -1) return null;

    for (var i = 0; i < ENGINES.length; i++) {
      if (ENGINES[i][0].test(host)) return { source: ENGINES[i][1], medium: 'organic' };
    }
    return { source: host, medium: 'referral' };
  }

  function label(rec) {
    if (!rec || !rec.source) return 'Organic / Direct';
    if (rec.source === 'Direct') return 'Organic / Direct';
    return rec.source + (rec.medium ? ' / ' + rec.medium : '');
  }

  function capture() {
    var existing = readStore();
    var touch    = fromUrl();

    if (!touch) {
      if (existing) return existing;          // keep the earlier ad click
      touch = fromReferrer();
      if (!touch) return existing;            // internal navigation, nothing stored
    }

    var rec = {
      ts:          Date.now(),
      firstSeen:   (existing && existing.firstSeen) || new Date().toISOString(),
      source:      touch.source   || '',
      medium:      touch.medium   || '',
      campaign:    touch.campaign || '',
      term:        touch.term     || '',
      content:     touch.content  || '',
      clickId:     touch.clickId  || '',
      landingPage: w.location.pathname + w.location.search,
      referrer:    d.referrer || ''
    };

    writeStore(rec);
    return rec;
  }

  var current = capture();

  w.HFSAttribution = {
    // Flat object for a form payload. Always returns every key, so callers
    // never have to null-check.
    get: function () {
      var rec = readStore() || current || {};
      return {
        leadSource:  label(rec),
        source:      rec.source      || '',
        medium:      rec.medium      || '',
        campaign:    rec.campaign    || '',
        term:        rec.term        || '',
        content:     rec.content     || '',
        clickId:     rec.clickId     || '',
        landingPage: rec.landingPage || '',
        referrer:    rec.referrer    || '',
        firstSeen:   rec.firstSeen   || ''
      };
    },

    // Clears the stored touch. Only for testing attribution by hand.
    reset: function () {
      try { w.localStorage.removeItem(KEY); } catch (e) {}
    }
  };
})(window, document);

/* ============================================================
   HVAC Flow Solutions — Stripe Payment Links
   ------------------------------------------------------------
   THE ONLY FILE YOU EDIT TO CHANGE CHECKOUT.

   Every page (pricing.html, index.html, contractor-form.html,
   contractor-trial.html) reads its checkout URLs from here, so
   a link only ever has to be pasted once.

   HOW TO FILL THIS IN
   1. Stripe Dashboard > Product catalogue > add each product below
      at the price shown in `amount`.
      - Memberships must be created as RECURRING / monthly prices.
      - Packages and the trial are ONE-TIME prices.
   2. Payment links > New > pick the product > Create link.
   3. On each link, open "After payment" and set
      "Confirmation page" > "Redirect to a page" > https://boosthvacleads.com/thanks.html
   4. Paste the https://buy.stripe.com/... URL into `url` below.

   Until a url is filled in, that checkout button is replaced on the
   page by a "call us to pay" message — nothing breaks, it just
   degrades to a phone number.
   ============================================================ */
(function (global) {
  'use strict';

  var NOT_SET = 'REPLACE_WITH_STRIPE_PAYMENT_LINK';

  // Monthly recurring memberships (pricing.html).
  // Checked BEFORE one-time packages, because "Starter Membership"
  // also contains the one-time package name "Starter".
  var MEMBERSHIPS = {
    'Starter Membership': { url: NOT_SET, amount: '$397' },
    'Growth Membership':  { url: NOT_SET, amount: '$697' },
    'Pro Membership':     { url: NOT_SET, amount: '$997' }
  };

  // One-time lead packages (index.html, contractor-form.html).
  var PACKAGES = {
    'Tester':      { url: NOT_SET, amount: '$75' },
    'Starter':     { url: NOT_SET, amount: '$150' },
    'Growth':      { url: NOT_SET, amount: '$375' },
    'Pro Partner': { url: NOT_SET, amount: '$700' },
    'Elite':       { url: NOT_SET, amount: '$1,300' }
  };

  // One-time 14-day trial fee (contractor-trial.html).
  var TRIAL = { url: NOT_SET, amount: '$25' };

  var SUPPORT_PHONE      = '(830) 538-0713';
  var SUPPORT_PHONE_HREF = 'tel:+18305380713';
  var SUPPORT_EMAIL      = 'hvacflowsolutions@gmail.com';

  function isConfigured(entry) {
    return !!(entry && entry.url && entry.url !== NOT_SET && entry.url.indexOf('http') === 0);
  }

  // Matches a package label ("Growth Membership — 20-30 leads") to its
  // checkout entry. Memberships win over packages on ambiguous names.
  function resolve(packageName) {
    var pkg = String(packageName || '');
    var name;

    for (name in MEMBERSHIPS) {
      if (pkg.indexOf(name) !== -1) {
        return { name: name, url: MEMBERSHIPS[name].url, amount: MEMBERSHIPS[name].amount, recurring: true };
      }
    }
    for (name in PACKAGES) {
      if (pkg.indexOf(name) !== -1) {
        return { name: name, url: PACKAGES[name].url, amount: PACKAGES[name].amount, recurring: false };
      }
    }
    return null;
  }

  function trial() {
    return { name: 'Trial', url: TRIAL.url, amount: TRIAL.amount, recurring: false };
  }

  // Stripe Payment Links accept only a small set of query params.
  // prefilled_email saves the contractor retyping it; client_reference_id
  // comes back on the webhook so we can match the payment to their row.
  function checkoutUrl(entry, opts) {
    if (!isConfigured(entry)) return null;
    opts = opts || {};

    var url = entry.url;
    var parts = [];

    if (opts.email) parts.push('prefilled_email=' + encodeURIComponent(opts.email));
    if (opts.reference) {
      var ref = String(opts.reference).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180);
      if (ref) parts.push('client_reference_id=' + ref);
    }
    if (!parts.length) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
  }

  // Stable-ish id we can eyeball in Stripe and match to the sheet row.
  function makeReference(company, email) {
    var seed = String(company || email || 'hfs').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    return (seed || 'HFS') + '-' + Date.now().toString(36).toUpperCase();
  }

  // Shared markup for "this link isn't set up yet" so no page ever
  // renders a dead button.
  function unavailableHtml(amount) {
    return '<div style="border:1.5px solid #d9dee7;border-radius:11px;padding:1rem;text-align:center;font-size:.86rem;line-height:1.6;color:#4a5568;">' +
      '<b>Online checkout is being set up.</b><br>' +
      'Call <a href="' + SUPPORT_PHONE_HREF + '" style="color:#f97316;font-weight:700;text-decoration:none;">' + SUPPORT_PHONE + '</a> ' +
      'or email <a href="mailto:' + SUPPORT_EMAIL + '" style="color:#f97316;font-weight:700;text-decoration:none;">' + SUPPORT_EMAIL + '</a> ' +
      'and we\'ll send you a secure ' + (amount ? amount + ' ' : '') + 'checkout link.' +
      '</div>';
  }

  global.HFS_PAY = {
    NOT_SET: NOT_SET,
    memberships: MEMBERSHIPS,
    packages: PACKAGES,
    supportPhone: SUPPORT_PHONE,
    supportPhoneHref: SUPPORT_PHONE_HREF,
    supportEmail: SUPPORT_EMAIL,
    isConfigured: isConfigured,
    resolve: resolve,
    trial: trial,
    checkoutUrl: checkoutUrl,
    makeReference: makeReference,
    unavailableHtml: unavailableHtml
  };
})(window);

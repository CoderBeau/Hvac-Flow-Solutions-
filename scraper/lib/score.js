// Prioritization rubric — mirrors the poaching playbook:
// "paying a lot and probably frustrated" outranks everything else.
'use strict';

// Badge/placement strings that mean the shop is SPENDING right now.
const PAID_SIGNALS = [
  'top pro',            // Thumbtack
  'angi certified',     // Angi
  'super service award',
  'angi approved',
  'screened & approved',
  'elite service',      // HomeAdvisor
  'google guaranteed',
  'sponsored',
  'featured',
  'accredited'          // BBB — paying member
];

function detectPaidSignals(text) {
  const t = String(text || '').toLowerCase();
  return PAID_SIGNALS.filter((s) => t.includes(s));
}

// score + tier for one merged prospect.
//   platforms:  array of platform names the shop was found on
//   signals:    array of paid badge strings detected
//   reviewCount: rough count if a source exposed one
//   hasOwner:   owner name found (owner-operated = feels every wasted dollar)
//   hasEmail:   direct email found (reachable on the best channel)
function scoreProspect({ platforms = [], signals = [], reviewCount = 0, hasOwner = false, hasEmail = false }) {
  let score = 0;
  const why = [];

  if (platforms.length >= 2) {
    score += 3 * (platforms.length - 1);
    why.push(`on ${platforms.length} lead platforms at once`);
  }
  if (signals.length) {
    score += 2 * Math.min(signals.length, 3);
    why.push(`paid placement: ${[...new Set(signals)].join(', ')}`);
  }
  if (reviewCount >= 20) {
    score += 1;
    why.push(`${reviewCount}+ reviews (active, will see outreach)`);
  }
  if (hasOwner) {
    score += 1;
    why.push('owner identified');
  }
  if (hasEmail) score += 1;

  const tier = score >= 5 ? 'Hot' : score >= 2 ? 'Warm' : 'Cool';
  return { score, tier, painSignal: why.join('; ') };
}

module.exports = { detectPaidSignals, scoreProspect, PAID_SIGNALS };

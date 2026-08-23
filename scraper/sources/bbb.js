// BBB — the enrichment goldmine. Small-shop profiles usually list the
// owner's full name ("Principal Contacts"), entity type, years in
// business, and a real city/zip. "Accredited" means they pay BBB dues
// — a shop already paying for credibility signals. Owner name alone
// massively improves outreach ("Hi Joe" beats "Hi there").
'use strict';

const { harvestProfiles } = require('../lib/harvest');

module.exports = {
  name: 'bbb',
  platform: 'BBB',
  async search({ context, metro, limit, delay, log }) {
    const loc = encodeURIComponent(`${metro.city}, ${metro.state}`);
    const searchUrl = `https://www.bbb.org/search?find_country=USA&find_text=HVAC&find_loc=${loc}`;
    return harvestProfiles({
      context, metro, limit, delay, log,
      platform: 'BBB',
      searchUrl,
      linkFilter: (href) => href.includes('bbb.org') && href.includes('/profile/'),
      // Sole proprietorship = owner-operated = the owner feels every
      // wasted lead dollar personally. Flag it as a pain signal.
      extractExtra: async (page, prospect, text) => {
        if (/sole proprietor/i.test(text)) prospect.signals.push('owner-operated (sole proprietor)');
        const years = text.match(/years? in business:?\s*([\d]+)/i);
        if (years) prospect.yearsInBusiness = parseInt(years[1], 10);
      }
    });
  }
};

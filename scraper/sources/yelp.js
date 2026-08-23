// Yelp — public HVAC search results. Yelp advertisers ("Sponsored"
// placements, Yelp Guaranteed) are spending on visibility with no
// lead guarantee — pitch exclusive pay-per-real-lead as the contrast.
// Yelp business pages embed solid JSON-LD (name, phone, address).
'use strict';

const { harvestProfiles } = require('../lib/harvest');

module.exports = {
  name: 'yelp',
  platform: 'Yelp Ads',
  async search({ context, metro, limit, delay, log }) {
    const loc = encodeURIComponent(`${metro.city}, ${metro.state}`);
    const searchUrl = `https://www.yelp.com/search?find_desc=HVAC&find_loc=${loc}`;
    return harvestProfiles({
      context, metro, limit, delay, log,
      platform: 'Yelp Ads',
      searchUrl,
      linkFilter: (href) => href.includes('yelp.com/biz/') && !href.includes('?')
    });
  }
};

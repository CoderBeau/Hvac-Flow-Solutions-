// Angi (includes the former HomeAdvisor inventory) — public company
// list by city/category. Paying contractors show "Angi Certified" /
// award badges and top placement. Recommended pitch wedge: shared
// leads + contract trap.
'use strict';

const { harvestProfiles } = require('../lib/harvest');

module.exports = {
  name: 'angi',
  platform: 'Angi',
  async search({ context, metro, limit, delay, log }) {
    const searchUrl = `https://www.angi.com/companylist/us/${metro.stateSlug}/${metro.citySlug}/hvac.htm`;
    return harvestProfiles({
      context, metro, limit, delay, log,
      platform: 'Angi',
      searchUrl,
      // Company profile URLs look like .../<name>-reviews-<id>.htm
      linkFilter: (href) => href.includes('angi.com') && /-reviews-\d+\.htm/.test(href)
    });
  }
};

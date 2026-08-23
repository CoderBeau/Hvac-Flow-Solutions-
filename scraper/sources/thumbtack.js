// Thumbtack — public HVAC pro listings by metro.
// Paying pros are visible via the "Top Pro" badge and heavy recent
// review counts. Recommended pitch wedge: paying for ghosts.
'use strict';

const { harvestProfiles } = require('../lib/harvest');

module.exports = {
  name: 'thumbtack',
  platform: 'Thumbtack',
  async search({ context, metro, limit, delay, log }) {
    const searchUrl = `https://www.thumbtack.com/${metro.stateSlug}/${metro.citySlug}/hvac-companies/`;
    return harvestProfiles({
      context, metro, limit, delay, log,
      platform: 'Thumbtack',
      searchUrl,
      // Pro profile URLs look like .../<business-slug>/service/<id>
      linkFilter: (href) => href.includes('thumbtack.com') && /\/service\/\d+/.test(href)
    });
  }
};

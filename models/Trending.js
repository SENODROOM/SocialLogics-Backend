const mongoose = require('mongoose');

const trendingSchema = new mongoose.Schema({
  query: { type: String, required: true, unique: true, trim: true, lowercase: true },
  displayQuery: { type: String, default: '' },
  count: { type: Number, default: 1, index: true },
  dailyCount: { type: Number, default: 1 },
  weeklyCount: { type: Number, default: 1 },
  score: { type: Number, default: 1, index: true },
  category: { type: String, default: 'general' },
  platforms: [{ type: String }],
  lastSearched: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

trendingSchema.index({ score: -1 });
trendingSchema.index({ dailyCount: -1 });
trendingSchema.index({ query: 'text' });

// Reset daily/weekly counts via scheduled job (call this from a cron or at startup)
trendingSchema.statics.seedDefaults = async function() {
  const count = await this.countDocuments();
  if (count > 0) return;
  const seeds = [
    { q:'AI generated videos', score:900 }, { q:'viral reels 2025', score:850 },
    { q:'trending shorts', score:800 }, { q:'music videos', score:780 },
    { q:'gaming highlights', score:750 }, { q:'travel vlog', score:700 },
    { q:'comedy clips', score:680 }, { q:'tech reviews', score:660 },
    { q:'sports highlights', score:640 }, { q:'cooking tutorials', score:620 },
    { q:'dance challenge', score:600 }, { q:'documentary', score:580 },
    { q:'minecraft builds', score:560 }, { q:'anime clips', score:540 },
    { q:'workout routine', score:520 }, { q:'lo-fi music', score:500 },
    { q:'street food', score:480 }, { q:'car reviews', score:460 },
    { q:'science experiments', score:440 }, { q:'movie trailers', score:420 },
  ];
  for (const s of seeds) {
    await this.create({ query: s.q.toLowerCase(), displayQuery: s.q, count: s.score, dailyCount: Math.floor(s.score/10), weeklyCount: Math.floor(s.score/3), score: s.score, lastSearched: new Date() });
  }
};

module.exports = mongoose.model('Trending', trendingSchema);

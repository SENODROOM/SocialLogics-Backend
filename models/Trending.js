const mongoose = require('mongoose');

const trendingSchema = new mongoose.Schema({
  query: { type: String, required: true, unique: true, trim: true, lowercase: true },
  count: { type: Number, default: 1 },
  category: { type: String, default: 'general' },
  platforms: [{ type: String }],
  lastSearched: { type: Date, default: Date.now },
}, { timestamps: true });

trendingSchema.index({ count: -1 });
trendingSchema.index({ lastSearched: -1 });

module.exports = mongoose.model('Trending', trendingSchema);

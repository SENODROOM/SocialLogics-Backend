const mongoose = require('mongoose');

const searchHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  query: { type: String, required: true, trim: true },
  platform: { type: String, default: 'all' },
  category: { type: String, default: '' },
  resultCount: { type: Number, default: 0 },
  ipAddress: { type: String, default: '' },
}, { timestamps: true });

searchHistorySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SearchHistory', searchHistorySchema);

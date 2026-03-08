const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  url: { type: String, required: true },
  platform: { type: String, required: true },
  thumbnail: { type: String, default: '' },
  description: { type: String, default: '' },
  tags: [{ type: String }],
  collection: { type: String, default: 'Default' },
  notes: { type: String, default: '' },
}, { timestamps: true });

bookmarkSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Bookmark', bookmarkSchema);

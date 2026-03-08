const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ─── User ────────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  avatar: { type: String, default: '' },
  bio: { type: String, default: '', maxlength: 300 },
  preferredPlatforms: [{ type: String }],
  theme: { type: String, enum: ['dark', 'cyber', 'neon', 'matrix'], default: 'cyber' },
  language: { type: String, default: 'en' },
  safeSearch: { type: Boolean, default: true },
  defaultSearchMode: { type: String, enum: ['all', 'single'], default: 'all' },
  savedSearches: [{
    query: String, platform: String, label: String,
    createdAt: { type: Date, default: Date.now }
  }],
  searchCount: { type: Number, default: 0 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date, default: Date.now },
  loginStreak: { type: Number, default: 0 },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.matchPassword = async function(p) { return bcrypt.compare(p, this.password); };
userSchema.methods.toPublic = function() { const o = this.toObject(); delete o.password; return o; };

// ─── Search History ──────────────────────────────────────────────────────────
const searchHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  query: { type: String, required: true, trim: true },
  normalizedQuery: { type: String, trim: true, lowercase: true },
  platform: { type: String, default: 'all' },
  category: { type: String, default: '' },
  contentType: { type: String, default: 'all' },
  filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  resultCount: { type: Number, default: 0 },
  clickedPlatforms: [{ type: String }],
  sessionId: { type: String, default: '' },
}, { timestamps: true });
searchHistorySchema.index({ user: 1, createdAt: -1 });
searchHistorySchema.index({ normalizedQuery: 'text' });

// ─── Bookmark ────────────────────────────────────────────────────────────────
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
  isFavorite: { type: Boolean, default: false },
  viewCount: { type: Number, default: 0 },
}, { timestamps: true });
bookmarkSchema.index({ user: 1, createdAt: -1 });
bookmarkSchema.index({ user: 1, collection: 1 });

// ─── Trending ────────────────────────────────────────────────────────────────
const trendingSchema = new mongoose.Schema({
  query: { type: String, required: true, unique: true, trim: true, lowercase: true },
  displayQuery: { type: String, trim: true },
  count: { type: Number, default: 1 },
  dailyCount: { type: Number, default: 1 },
  weeklyCount: { type: Number, default: 1 },
  score: { type: Number, default: 1 },
  category: { type: String, default: 'general' },
  platforms: [{ type: String }],
  relatedQueries: [{ type: String }],
  lastSearched: { type: Date, default: Date.now },
  peakDate: { type: Date, default: Date.now },
}, { timestamps: true });
trendingSchema.index({ score: -1 });
trendingSchema.index({ dailyCount: -1 });
trendingSchema.index({ query: 'text', displayQuery: 'text' });

// ─── Collection ──────────────────────────────────────────────────────────────
const collectionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  color: { type: String, default: '#00f5ff' },
  icon: { type: String, default: '📁' },
  isPublic: { type: Boolean, default: false },
  bookmarkCount: { type: Number, default: 0 },
}, { timestamps: true });

// ─── Alert / Saved Search Alert ──────────────────────────────────────────────
const searchAlertSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  query: { type: String, required: true },
  platform: { type: String, default: 'all' },
  frequency: { type: String, enum: ['realtime', 'daily', 'weekly'], default: 'daily' },
  isActive: { type: Boolean, default: true },
  lastTriggered: { type: Date },
  triggerCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = {
  User: mongoose.model('User', userSchema),
  SearchHistory: mongoose.model('SearchHistory', searchHistorySchema),
  Bookmark: mongoose.model('Bookmark', bookmarkSchema),
  Trending: mongoose.model('Trending', trendingSchema),
  Collection: mongoose.model('Collection', collectionSchema),
  SearchAlert: mongoose.model('SearchAlert', searchAlertSchema),
};

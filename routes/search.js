const express = require('express');
const router = express.Router();
const SearchHistory = require('../models/SearchHistory');
const Trending = require('../models/Trending');
const { optionalAuth, protect } = require('../middleware/auth');

const PLATFORMS = [
  { id: 'youtube', name: 'YouTube', color: '#FF0000', icon: '▶',
    searchUrl: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    category: 'video' },
  { id: 'facebook', name: 'Facebook', color: '#1877F2', icon: 'f',
    searchUrl: (q) => `https://www.facebook.com/search/videos/?q=${encodeURIComponent(q)}`,
    category: 'social' },
  { id: 'instagram', name: 'Instagram', color: '#E1306C', icon: '◎',
    searchUrl: (q) => `https://www.instagram.com/explore/tags/${encodeURIComponent(q.replace(/ /g, ''))}/`,
    category: 'social' },
  { id: 'tiktok', name: 'TikTok', color: '#69C9D0', icon: '♪',
    searchUrl: (q) => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}`,
    category: 'short' },
  { id: 'dailymotion', name: 'Dailymotion', color: '#0066DC', icon: '◉',
    searchUrl: (q) => `https://www.dailymotion.com/search/${encodeURIComponent(q)}`,
    category: 'video' },
  { id: 'twitter', name: 'X / Twitter', color: '#ffffff', icon: '✕',
    searchUrl: (q) => `https://twitter.com/search?q=${encodeURIComponent(q)}&f=video`,
    category: 'social' },
  { id: 'twitch', name: 'Twitch', color: '#9146FF', icon: '◈',
    searchUrl: (q) => `https://www.twitch.tv/search?term=${encodeURIComponent(q)}`,
    category: 'live' },
  { id: 'reddit', name: 'Reddit', color: '#FF4500', icon: '◍',
    searchUrl: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}&type=video`,
    category: 'community' },
  { id: 'vimeo', name: 'Vimeo', color: '#1AB7EA', icon: '◐',
    searchUrl: (q) => `https://vimeo.com/search?q=${encodeURIComponent(q)}`,
    category: 'video' },
  { id: 'snapchat', name: 'Snapchat', color: '#FFFC00', icon: '◌',
    searchUrl: (q) => `https://www.snapchat.com/search?q=${encodeURIComponent(q)}`,
    category: 'social' },
  { id: 'pinterest', name: 'Pinterest', color: '#E60023', icon: '⊕',
    searchUrl: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
    category: 'visual' },
  { id: 'linkedin', name: 'LinkedIn', color: '#0A66C2', icon: 'in',
    searchUrl: (q) => `https://www.linkedin.com/search/results/videos/?keywords=${encodeURIComponent(q)}`,
    category: 'professional' },
  { id: 'rumble', name: 'Rumble', color: '#85C742', icon: 'R',
    searchUrl: (q) => `https://rumble.com/search/video?q=${encodeURIComponent(q)}`,
    category: 'video' },
  { id: 'odysee', name: 'Odysee', color: '#EF1970', icon: '∞',
    searchUrl: (q) => `https://odysee.com/$/search?q=${encodeURIComponent(q)}`,
    category: 'decentralized' },
];

// GET /api/search/platforms
router.get('/platforms', (req, res) => {
  res.json({ platforms: PLATFORMS });
});

// POST /api/search - Log search & return platform URLs
router.post('/', optionalAuth, async (req, res) => {
  const { query, platform = 'all', category = '' } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'Query is required' });

  const q = query.trim();

  try {
    // Save search history for logged in users
    if (req.user) {
      await SearchHistory.create({
        user: req.user._id,
        query: q,
        platform,
        category,
        ipAddress: req.ip,
      });
    }

    // Update trending
    await Trending.findOneAndUpdate(
      { query: q.toLowerCase() },
      { $inc: { count: 1 }, $set: { lastSearched: new Date() }, $addToSet: { platforms: platform } },
      { upsert: true }
    );

    // Build result URLs
    const targets = platform === 'all'
      ? PLATFORMS
      : PLATFORMS.filter(p => p.id === platform);

    const results = targets.map(p => ({
      platform: p.id,
      name: p.name,
      color: p.color,
      icon: p.icon,
      url: p.searchUrl(q),
    }));

    res.json({ query: q, platform, results, total: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search/suggestions?q=
router.get('/suggestions', async (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.json({ suggestions: [] });
  try {
    const suggestions = await Trending.find({
      query: { $regex: q.toLowerCase(), $options: 'i' }
    }).sort({ count: -1 }).limit(8).select('query count');
    res.json({ suggestions: suggestions.map(s => ({ query: s.query, count: s.count })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

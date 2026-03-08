const express = require('express');
const router = express.Router();
const Trending = require('../models/Trending');

// Seed default trending if empty
const seedTrending = async () => {
  const count = await Trending.countDocuments();
  if (count === 0) {
    const seeds = [
      'AI generated videos', 'viral reels 2025', 'trending shorts', 'music videos',
      'gaming clips', 'travel vlogs', 'comedy skits', 'tech reviews',
      'sports highlights', 'cooking tutorials', 'dance challenges', 'documentary films',
      'minecraft builds', 'anime clips', 'workout routines', 'lo-fi music',
      'street food', 'car reviews', 'science experiments', 'movie trailers'
    ];
    for (const q of seeds) {
      await Trending.create({ query: q, count: Math.floor(Math.random() * 1000) + 100, category: 'general' });
    }
  }
};
seedTrending();

router.get('/', async (req, res) => {
  const { limit = 20, category } = req.query;
  const filter = category ? { category } : {};
  try {
    const trending = await Trending.find(filter)
      .sort({ count: -1 })
      .limit(Number(limit))
      .select('query count category lastSearched');
    res.json({ trending });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

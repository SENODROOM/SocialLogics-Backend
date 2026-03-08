const express = require('express');
const router = express.Router();
const User = require('../models/User');
const SearchHistory = require('../models/SearchHistory');
const Bookmark = require('../models/Bookmark');
const { protect, adminOnly } = require('../middleware/auth');

// GET /api/users/stats - personal stats
router.get('/stats', protect, async (req, res) => {
  try {
    const [totalSearches, totalBookmarks, topPlatforms] = await Promise.all([
      SearchHistory.countDocuments({ user: req.user._id }),
      Bookmark.countDocuments({ user: req.user._id }),
      SearchHistory.aggregate([
        { $match: { user: req.user._id } },
        { $group: { _id: '$platform', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ])
    ]);
    res.json({ totalSearches, totalBookmarks, topPlatforms });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/users/saved-searches
router.post('/saved-searches', protect, async (req, res) => {
  const { query, platform } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $push: { savedSearches: { query, platform, createdAt: new Date() } } },
      { new: true }
    ).select('-password');
    res.json({ savedSearches: user.savedSearches });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/saved-searches/:index', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.savedSearches.splice(req.params.index, 1);
    await user.save();
    res.json({ savedSearches: user.savedSearches });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: GET all users
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

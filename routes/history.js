// routes/history.js
const express = require('express');
const router = express.Router();
const SearchHistory = require('../models/SearchHistory');
const { protect } = require('../middleware/auth');

router.get('/', protect, async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  try {
    const history = await SearchHistory.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await SearchHistory.countDocuments({ user: req.user._id });
    res.json({ history, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    await SearchHistory.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/', protect, async (req, res) => {
  try {
    await SearchHistory.deleteMany({ user: req.user._id });
    res.json({ message: 'History cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

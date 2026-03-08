const express = require('express');
const router = express.Router();
const Bookmark = require('../models/Bookmark');
const { protect } = require('../middleware/auth');

router.get('/', protect, async (req, res) => {
  const { collection, page = 1, limit = 20 } = req.query;
  const filter = { user: req.user._id };
  if (collection) filter.collection = collection;
  try {
    const bookmarks = await Bookmark.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Bookmark.countDocuments(filter);
    const collections = await Bookmark.distinct('collection', { user: req.user._id });
    res.json({ bookmarks, total, collections, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', protect, async (req, res) => {
  const { title, url, platform, thumbnail, description, tags, collection, notes } = req.body;
  if (!title || !url || !platform) return res.status(400).json({ error: 'title, url, platform required' });
  try {
    const bookmark = await Bookmark.create({
      user: req.user._id, title, url, platform, thumbnail, description,
      tags: tags || [], collection: collection || 'Default', notes
    });
    res.status(201).json({ bookmark });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', protect, async (req, res) => {
  try {
    const bookmark = await Bookmark.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body, { new: true }
    );
    if (!bookmark) return res.status(404).json({ error: 'Bookmark not found' });
    res.json({ bookmark });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    await Bookmark.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

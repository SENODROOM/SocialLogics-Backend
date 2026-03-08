const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/searchController');
const { optionalAuth } = require('../middleware/auth');

router.get('/platforms',          ctrl.getPlatforms);
router.post('/',       optionalAuth, ctrl.search);
router.get('/suggestions',optionalAuth, ctrl.getSuggestions);
router.get('/trending',           ctrl.getTrending);
router.post('/click',  optionalAuth, ctrl.recordClick);
router.get('/stats',              ctrl.getSearchStats);

module.exports = router;

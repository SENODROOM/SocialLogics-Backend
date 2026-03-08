const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/searchController');

router.get('/', ctrl.getTrending);

module.exports = router;

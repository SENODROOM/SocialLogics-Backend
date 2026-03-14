const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const {
  User,
  SearchHistory,
  Bookmark,
  Collection,
  SearchAlert,
  Trending,
} = require("../models");
const {
  protect,
  optionalAuth,
  adminOnly,
  authLimiter,
  asyncHandler,
} = require("../middleware");
const searchCtrl = require("../controllers/searchController");
const recsCtrl = require("../controllers/recommendationsController");

const genToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
const validate = (req, res, next) => {
  const errs = validationResult(req);
  if (!errs.isEmpty())
    return res.status(400).json({ success: false, errors: errs.array() });
  next();
};

// ══════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════
router.post(
  "/auth/register",
  authLimiter,
  [
    body("username")
      .trim()
      .isLength({ min: 3, max: 30 })
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage("Username: 3-30 alphanumeric chars"),
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 6 }).withMessage("Password min 6 chars"),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;
    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists)
      return res.status(400).json({
        success: false,
        error:
          exists.email === email
            ? "Email already registered"
            : "Username taken",
      });
    const user = await User.create({ username, email, password });
    res.status(201).json({
      success: true,
      data: { token: genToken(user._id), user: user.toPublic() },
    });
  }),
);

router.post(
  "/auth/login",
  authLimiter,
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password)))
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    if (!user.isActive)
      return res
        .status(403)
        .json({ success: false, error: "Account deactivated" });
    user.lastLogin = new Date();
    user.loginStreak = (user.loginStreak || 0) + 1;
    await user.save();
    res.json({
      success: true,
      data: { token: genToken(user._id), user: user.toPublic() },
    });
  }),
);

router.get("/auth/me", protect, (req, res) =>
  res.json({ success: true, data: { user: req.user } }),
);

router.put(
  "/auth/profile",
  protect,
  asyncHandler(async (req, res) => {
    const allowed = [
      "bio",
      "preferredPlatforms",
      "theme",
      "avatar",
      "language",
      "safeSearch",
      "defaultSearchMode",
    ];
    const updates = {};
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    }).select("-password");
    res.json({ success: true, data: { user } });
  }),
);

router.put(
  "/auth/change-password",
  protect,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res
        .status(400)
        .json({ success: false, error: "New password min 6 chars" });
    const user = await User.findById(req.user._id);
    if (!(await user.matchPassword(currentPassword)))
      return res
        .status(400)
        .json({ success: false, error: "Current password incorrect" });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: "Password updated" });
  }),
);

// ══════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════
router.get("/search/platforms", searchCtrl.getPlatforms);
router.get("/search/suggestions", optionalAuth, searchCtrl.getSuggestions);
router.get("/search/trending", searchCtrl.getTrending);
router.get("/search/stats", searchCtrl.getSearchStats);
router.post("/search", optionalAuth, searchCtrl.search);
router.post("/search/click", optionalAuth, searchCtrl.recordClick);

// ══════════════════════════════════════════════════
// RECOMMENDATIONS
// ══════════════════════════════════════════════════
router.get("/recommendations", optionalAuth, recsCtrl.getRecommendations);

// ══════════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════════
router.get(
  "/history",
  protect,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, q, platform } = req.query;
    const filter = { user: req.user._id };
    if (q) filter.normalizedQuery = { $regex: q.toLowerCase(), $options: "i" };
    if (platform && platform !== "all") filter.platform = platform;
    const [history, total] = await Promise.all([
      SearchHistory.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(+limit),
      SearchHistory.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: { history, total, page: +page, pages: Math.ceil(total / limit) },
    });
  }),
);

router.delete(
  "/history/:id",
  protect,
  asyncHandler(async (req, res) => {
    await SearchHistory.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    res.json({ success: true, message: "Deleted" });
  }),
);

router.delete(
  "/history",
  protect,
  asyncHandler(async (req, res) => {
    const { before } = req.query;
    const filter = { user: req.user._id };
    if (before) filter.createdAt = { $lt: new Date(before) };
    const result = await SearchHistory.deleteMany(filter);
    res.json({
      success: true,
      message: `${result.deletedCount} entries cleared`,
    });
  }),
);

// ══════════════════════════════════════════════════
// BOOKMARKS
// ══════════════════════════════════════════════════
router.get(
  "/bookmarks",
  protect,
  asyncHandler(async (req, res) => {
    const {
      collection,
      platform,
      page = 1,
      limit = 24,
      sort = "newest",
      q,
      favorite,
    } = req.query;
    const filter = { user: req.user._id };
    if (collection) filter.collection = collection;
    if (platform) filter.platform = platform;
    if (q) filter.title = { $regex: q, $options: "i" };
    if (favorite === "true") filter.isFavorite = true;
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name: { title: 1 },
      views: { viewCount: -1 },
    };
    const [bookmarks, total, collections] = await Promise.all([
      Bookmark.find(filter)
        .sort(sortMap[sort] || sortMap.newest)
        .skip((page - 1) * limit)
        .limit(+limit),
      Bookmark.countDocuments(filter),
      Bookmark.distinct("collection", { user: req.user._id }),
    ]);
    res.json({
      success: true,
      data: {
        bookmarks,
        total,
        collections,
        page: +page,
        pages: Math.ceil(total / limit),
      },
    });
  }),
);

router.post(
  "/bookmarks",
  protect,
  asyncHandler(async (req, res) => {
    const {
      title,
      url,
      platform,
      thumbnail,
      description,
      tags,
      collection,
      notes,
    } = req.body;
    if (!title || !url || !platform)
      return res
        .status(400)
        .json({ success: false, error: "title, url, platform required" });
    const bookmark = await Bookmark.create({
      user: req.user._id,
      title,
      url,
      platform,
      thumbnail,
      description,
      tags: tags || [],
      collection: collection || "Default",
      notes,
    });
    res.status(201).json({ success: true, data: { bookmark } });
  }),
);

router.put(
  "/bookmarks/:id",
  protect,
  asyncHandler(async (req, res) => {
    const bookmark = await Bookmark.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true },
    );
    if (!bookmark)
      return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: { bookmark } });
  }),
);

router.delete(
  "/bookmarks/:id",
  protect,
  asyncHandler(async (req, res) => {
    await Bookmark.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ success: true, message: "Deleted" });
  }),
);

router.post(
  "/bookmarks/:id/toggle-favorite",
  protect,
  asyncHandler(async (req, res) => {
    const bookmark = await Bookmark.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!bookmark)
      return res.status(404).json({ success: false, error: "Not found" });
    bookmark.isFavorite = !bookmark.isFavorite;
    await bookmark.save();
    res.json({ success: true, data: { isFavorite: bookmark.isFavorite } });
  }),
);

// ══════════════════════════════════════════════════
// COLLECTIONS
// ══════════════════════════════════════════════════
router.get(
  "/collections",
  protect,
  asyncHandler(async (req, res) => {
    const collections = await Collection.find({ user: req.user._id }).sort({
      name: 1,
    });
    res.json({ success: true, data: { collections } });
  }),
);

router.post(
  "/collections",
  protect,
  asyncHandler(async (req, res) => {
    const { name, description, color, icon } = req.body;
    if (!name)
      return res.status(400).json({ success: false, error: "Name required" });
    const col = await Collection.create({
      user: req.user._id,
      name,
      description,
      color: color || "#00f5ff",
      icon: icon || "📁",
    });
    res.status(201).json({ success: true, data: { collection: col } });
  }),
);

router.delete(
  "/collections/:id",
  protect,
  asyncHandler(async (req, res) => {
    await Collection.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    res.json({ success: true });
  }),
);

// ══════════════════════════════════════════════════
// ALERTS
// ══════════════════════════════════════════════════
router.get(
  "/alerts",
  protect,
  asyncHandler(async (req, res) => {
    const alerts = await SearchAlert.find({ user: req.user._id }).sort({
      createdAt: -1,
    });
    res.json({ success: true, data: { alerts } });
  }),
);

router.post(
  "/alerts",
  protect,
  asyncHandler(async (req, res) => {
    const { query, platform, frequency } = req.body;
    if (!query)
      return res.status(400).json({ success: false, error: "Query required" });
    const alert = await SearchAlert.create({
      user: req.user._id,
      query,
      platform: platform || "all",
      frequency: frequency || "daily",
    });
    res.status(201).json({ success: true, data: { alert } });
  }),
);

router.delete(
  "/alerts/:id",
  protect,
  asyncHandler(async (req, res) => {
    await SearchAlert.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    res.json({ success: true });
  }),
);

// ══════════════════════════════════════════════════
// USER STATS & DASHBOARD
// ══════════════════════════════════════════════════
router.get(
  "/users/stats",
  protect,
  asyncHandler(async (req, res) => {
    const uid = req.user._id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600000);
    const [
      totalSearches,
      recentSearches,
      totalBookmarks,
      topPlatforms,
      topQueries,
      searchTimeline,
    ] = await Promise.all([
      SearchHistory.countDocuments({ user: uid }),
      SearchHistory.countDocuments({
        user: uid,
        createdAt: { $gte: thirtyDaysAgo },
      }),
      Bookmark.countDocuments({ user: uid }),
      SearchHistory.aggregate([
        { $match: { user: uid } },
        { $group: { _id: "$platform", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 7 },
      ]),
      SearchHistory.aggregate([
        { $match: { user: uid } },
        { $group: { _id: { $toLower: "$query" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      SearchHistory.aggregate([
        { $match: { user: uid, createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);
    res.json({
      success: true,
      data: {
        totalSearches,
        recentSearches,
        totalBookmarks,
        topPlatforms,
        topQueries,
        searchTimeline,
        loginStreak: req.user.loginStreak,
      },
    });
  }),
);

router.post(
  "/users/saved-searches",
  protect,
  asyncHandler(async (req, res) => {
    const { query, platform, label } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $push: {
          savedSearches: { query, platform, label, createdAt: new Date() },
        },
      },
      { new: true },
    ).select("-password");
    res.json({ success: true, data: { savedSearches: user.savedSearches } });
  }),
);

router.delete(
  "/users/saved-searches/:index",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    user.savedSearches.splice(+req.params.index, 1);
    await user.save();
    res.json({ success: true, data: { savedSearches: user.savedSearches } });
  }),
);

// ══════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════
router.get(
  "/admin/users",
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json({ success: true, data: { users } });
  }),
);

router.get(
  "/admin/stats",
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const [users, searches, bookmarks, trending] = await Promise.all([
      User.countDocuments(),
      SearchHistory.countDocuments(),
      Bookmark.countDocuments(),
      Trending.find()
        .sort({ score: -1 })
        .limit(20)
        .select("displayQuery count score"),
    ]);
    res.json({ success: true, data: { users, searches, bookmarks, trending } });
  }),
);
/**
 * backend/routes/index.js  — Shorts Feed Route (upgraded)
 *
 * ✅ FIX: Server-side oEmbed validation before returning videos to client
 * ✅ FIX: Caches unavailable video IDs to avoid re-checking them
 * ✅ NEW: /api/shorts/validate endpoint for client to check a batch
 * ✅ NEW: Richer response with thumbnail URLs
 */
const axios = require("axios");
const { cache } = require("../utils/cache");

// ── Query pools ───────────────────────────────────────────────────────────────
const SHORTS_QUERIES = {
  "For You": [
    "viral shorts 2025",
    "trending short videos",
    "funny moments shorts",
    "satisfying videos short",
    "amazing clips 2025",
  ],
  Trending: [
    "trending now 2025",
    "viral today",
    "hot right now shorts",
    "what everyone watching",
    "breaking trending shorts",
  ],
  Music: [
    "music shorts 2025",
    "new song short",
    "viral music clip",
    "official music short",
    "pop music trending shorts",
  ],
  Dance: [
    "dance shorts viral",
    "trending dance 2025",
    "dance challenge short",
    "best dance clips",
    "viral choreography short",
  ],
  Comedy: [
    "funny short 2025",
    "comedy clips viral",
    "hilarious moments short",
    "stand up clips short",
    "funny fails 2025",
  ],
  Food: [
    "food shorts viral",
    "cooking shorts 2025",
    "recipe short video",
    "street food short",
    "satisfying food clips",
  ],
  Sports: [
    "sports shorts viral",
    "amazing sports moments",
    "highlights short clip",
    "extreme sports shorts",
    "best plays short",
  ],
  Travel: [
    "travel shorts 2025",
    "places to visit short",
    "beautiful destinations shorts",
    "travel vlog short",
    "hidden gems travel",
  ],
  Art: [
    "art shorts viral",
    "drawing short video",
    "satisfying art clips",
    "creative shorts 2025",
    "amazing art timelapse",
  ],
  Fitness: [
    "workout shorts 2025",
    "fitness tips short",
    "exercise clips viral",
    "gym shorts motivation",
    "health tips short video",
  ],
};

const SHORTS_HTTP = axios.create({
  timeout: 8000,
  headers: {
    "User-Agent": "SocialLogics/3.0",
    Accept: "text/xml,application/xml",
  },
});

// ── In-memory unavailability cache (persists until server restart) ─────────────
// Maps ytId -> { available: bool, checkedAt: timestamp }
const unavailCache = new Map();
const UNAVAIL_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function isUnavailCached(ytId) {
  const entry = unavailCache.get(ytId);
  if (!entry) return null; // unknown
  if (Date.now() - entry.checkedAt > UNAVAIL_TTL_MS) {
    unavailCache.delete(ytId);
    return null; // expired
  }
  return entry.available; // true or false
}

function cacheAvailability(ytId, available) {
  unavailCache.set(ytId, { available, checkedAt: Date.now() });
}

// ── oEmbed check ──────────────────────────────────────────────────────────────
async function checkEmbeddable(ytId) {
  const cached = isUnavailCached(ytId);
  if (cached !== null) return cached;

  try {
    const res = await axios.get(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`,
      { timeout: 4000, validateStatus: () => true },
    );
    const available = res.status === 200;
    cacheAvailability(ytId, available);
    return available;
  } catch {
    // If network error, optimistically allow (client will catch it)
    return true;
  }
}

/**
 * Validate an array of video objects in parallel.
 * Returns only the embeddable ones.
 */
async function filterEmbeddable(videos, concurrency = 10) {
  const results = [];
  for (let i = 0; i < videos.length; i += concurrency) {
    const chunk = videos.slice(i, i + concurrency);
    const checks = await Promise.all(
      chunk.map(async (v) => ({ v, ok: await checkEmbeddable(v.ytId) })),
    );
    for (const { v, ok } of checks) {
      if (ok) results.push(v);
    }
  }
  return results;
}

// ── RSS parser ────────────────────────────────────────────────────────────────
const parseYtRss = (xml, limit) => {
  if (!xml || typeof xml !== "string") return [];
  const results = [];
  const entryRx = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRx.exec(xml)) !== null && results.length < limit) {
    const entry = m[1];
    const idMatch =
      entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) ||
      entry.match(/<id>[^<]*:video:([^<]+)<\/id>/);
    const titleMatch = entry.match(
      /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/,
    );
    const authorMatch = entry.match(/<n>([\s\S]*?)<\/name>/);
    if (!idMatch || !titleMatch) continue;
    const ytId = idMatch[1].trim();
    results.push({
      ytId,
      title: titleMatch[1]
        .replace(/<!\[CDATA\[|\]\]>/g, "")
        .trim()
        .substring(0, 80),
      creator: authorMatch
        ? "@" +
          authorMatch[1]
            .replace(/<!\[CDATA\[|\]\]>/g, "")
            .trim()
            .replace(/\s+/g, "")
        : "@creator",
      // Include thumbnail URL for client-side queue panel
      thumbnail: `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`,
    });
  }
  return results;
};

// ── GET /api/shorts/feed ──────────────────────────────────────────────────────
router.get(
  "/shorts/feed",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const cat = req.query.cat || "For You";
    const limit = Math.min(20, parseInt(req.query.limit) || 15);
    // skip_validation=1 allows client to opt out (for speed, client-side checks take over)
    const skipValidation = req.query.skip_validation === "1";

    const queryPool = SHORTS_QUERIES[cat] || SHORTS_QUERIES["For You"];
    const query = queryPool[(page - 1) % queryPool.length];
    const pageModifiers = [
      "",
      "part 2",
      "compilation",
      "2025",
      "new",
      "best of",
      "top",
      "viral",
    ];
    const mod =
      pageModifiers[
        Math.floor((page - 1) / queryPool.length) % pageModifiers.length
      ];
    const finalQuery = mod ? `${query} ${mod}` : query;

    // Cache key — validated results cached for 10 minutes
    const cacheKey = `shorts:feed:${cat}:${page}:${limit}:validated`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, cached: true, ...cached });
    }

    try {
      const url = `https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(finalQuery)}`;
      const { data: xml } = await SHORTS_HTTP.get(url, {
        responseType: "text",
      });

      // Parse more than needed to account for unavailable videos being filtered
      const raw = parseYtRss(xml, limit * 3);

      // Deduplicate by ytId
      const seen = new Set();
      const deduplicated = raw.filter((v) => {
        if (seen.has(v.ytId)) return false;
        seen.add(v.ytId);
        return true;
      });

      // Filter out known-unavailable videos (fast — cached)
      const knownAvailable = deduplicated.filter((v) => {
        const cachedStatus = isUnavailCached(v.ytId);
        return cachedStatus !== false; // include unknown (null) and available (true)
      });

      let videos;
      if (skipValidation) {
        // Return known-available + unknowns without checking — client will handle rest
        videos = knownAvailable.slice(0, limit).map((v) => ({ ...v, cat }));
      } else {
        // Full server-side validation (slower but guarantees embeddable)
        const validated = await filterEmbeddable(knownAvailable, 10);
        videos = validated.slice(0, limit).map((v) => ({ ...v, cat }));
      }

      const payload = {
        videos,
        page,
        hasMore: videos.length >= limit,
        validatedServerSide: !skipValidation,
      };

      // Cache for 10 minutes
      cache.set(cacheKey, payload, 600);

      return res.json({ success: true, cached: false, ...payload });
    } catch (err) {
      return res.status(502).json({
        success: false,
        error: "Failed to fetch shorts feed",
        details: err.message,
      });
    }
  }),
);

// ── POST /api/shorts/validate ─────────────────────────────────────────────────
/**
 * Client sends a list of ytIds to check, server responds with which are available.
 * Body: { ytIds: ["abc", "def", ...] }
 * Response: { results: { "abc": true, "def": false, ... } }
 */
router.post(
  "/shorts/validate",
  asyncHandler(async (req, res) => {
    const { ytIds } = req.body || {};
    if (!Array.isArray(ytIds) || ytIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "ytIds array required" });
    }

    // Limit to 50 per request
    const ids = ytIds.slice(0, 50);

    const results = {};
    await Promise.all(
      ids.map(async (ytId) => {
        results[ytId] = await checkEmbeddable(ytId);
      }),
    );

    res.json({ success: true, results });
  }),
);

// ── GET /api/shorts/validate-single ──────────────────────────────────────────
router.get(
  "/shorts/validate-single",
  asyncHandler(async (req, res) => {
    const { ytId } = req.query;
    if (!ytId)
      return res.status(400).json({ success: false, error: "ytId required" });
    const available = await checkEmbeddable(ytId);
    res.json({ success: true, ytId, available });
  }),
);

module.exports = router;

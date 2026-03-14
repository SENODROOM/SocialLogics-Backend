const { SearchHistory, Trending, User } = require("../models"); // ✅ Bug 4 Fixed: User moved to top
const {
  PLATFORMS,
  getPlatformById,
  getPlatformsByCategory,
} = require("../utils/platforms");
const { cache } = require("../utils/cache");
const { asyncHandler } = require("../middleware");

// Intelligent query normalization
const normalizeQuery = (q) => q.trim().toLowerCase().replace(/\s+/g, " ");

// Smart query enhancement — expands abbreviations, fixes typos pattern
const enhanceQuery = (q) => {
  const expansions = {
    ai: "artificial intelligence",
    ml: "machine learning",
    js: "javascript",
    ts: "typescript",
    py: "python",
    yt: "youtube tutorial",
    diy: "do it yourself",
    irl: "in real life",
    asmr: "asmr",
  };
  const words = q.toLowerCase().split(" ");
  return words.map((w) => expansions[w] || w).join(" ");
};

// Score-based trending weight calculation
const calcTrendingScore = (count, dailyCount, lastSearched) => {
  const hoursSince = (Date.now() - new Date(lastSearched)) / 3600000;
  const recencyBoost = Math.max(0, 1 - hoursSince / 72);
  return count * 0.3 + dailyCount * 0.5 + recencyBoost * 100;
};

// Update trending with smart scoring
const updateTrending = async (query, platform) => {
  const normalized = normalizeQuery(query);
  try {
    const existing = await Trending.findOne({ query: normalized });
    if (existing) {
      existing.count += 1;
      existing.dailyCount += 1;
      existing.weeklyCount += 1;
      existing.lastSearched = new Date();
      existing.score = calcTrendingScore(
        existing.count,
        existing.dailyCount,
        existing.lastSearched,
      );
      if (platform && !existing.platforms.includes(platform))
        existing.platforms.push(platform);
      await existing.save();
    } else {
      await Trending.create({
        query: normalized,
        displayQuery: query.trim(),
        count: 1,
        dailyCount: 1,
        weeklyCount: 1,
        score: 1,
        platforms: platform ? [platform] : [],
        lastSearched: new Date(),
      });
    }
    cache.del(`suggestions:${normalized.substring(0, 3)}`);
  } catch {}
};

// Build search results with all available URL modes
const buildResults = (query, platforms, filters = {}) => {
  return platforms.map((p) => {
    const urls = { main: p.searchUrl(query) };
    if (p.shortsUrl) urls.shorts = p.shortsUrl(query);
    if (p.liveUrl) urls.live = p.liveUrl(query);
    if (p.channelUrl) urls.channels = p.channelUrl(query);
    if (p.reelsUrl) urls.reels = p.reelsUrl(query);
    if (p.videoUrl) urls.videos = p.videoUrl(query);
    if (p.clipsUrl) urls.clips = p.clipsUrl(query);
    if (p.communityUrl) urls.community = p.communityUrl(query);
    return {
      platform: p.id,
      name: p.name,
      color: p.color,
      colorSecondary: p.colorSecondary || p.color,
      icon: p.icon,
      category: p.category,
      contentTypes: p.contentTypes,
      monthlyUsers: p.monthlyUsers,
      urls,
      mainUrl: urls.main,
      tags: p.tags,
    };
  });
};

// ─── GET /api/search/platforms ───────────────────────────────────────────────
exports.getPlatforms = asyncHandler(async (req, res) => {
  const { category = "all" } = req.query;
  const platforms = getPlatformsByCategory(category);
  res.json({
    success: true,
    data: {
      platforms,
      categories: require("../utils/platforms").PLATFORM_CATEGORIES,
    },
  });
});

// ─── POST /api/search ────────────────────────────────────────────────────────
exports.search = asyncHandler(async (req, res) => {
  const {
    query,
    platform = "all",
    category = "",
    contentType = "all",
    filters = {},
    sessionId = "",
    openAll = false,
  } = req.body;

  if (!query?.trim())
    return res.status(400).json({ success: false, error: "Query required" });

  const q = query.trim();
  const enhanced = enhanceQuery(q);

  let targetPlatforms;
  if (platform === "all") {
    targetPlatforms = category ? getPlatformsByCategory(category) : PLATFORMS;
  } else {
    const single = getPlatformById(platform);
    targetPlatforms = single ? [single] : PLATFORMS;
  }

  if (contentType && contentType !== "all") {
    targetPlatforms = targetPlatforms.filter((p) =>
      p.tags.some((t) => t.toLowerCase().includes(contentType.toLowerCase())),
    );
  }

  const results = buildResults(q, targetPlatforms, filters);

  if (req.user) {
    SearchHistory.create({
      user: req.user._id,
      query: q,
      normalizedQuery: normalizeQuery(q),
      platform,
      category,
      contentType,
      filters,
      resultCount: results.length,
      sessionId,
    }).catch(() => {});
    // ✅ Bug 4 Fixed: User is now defined at the top of the file
    User.findByIdAndUpdate(req.user._id, { $inc: { searchCount: 1 } }).catch(
      () => {},
    );
  }

  updateTrending(q, platform);

  // ✅ Bug 1 Fixed: duplicate `query` key merged into a single $and query
  const relatedRaw = await Trending.find({
    $and: [
      { query: { $regex: normalizeQuery(q).split(" ")[0], $options: "i" } },
      { query: { $ne: normalizeQuery(q) } },
    ],
  })
    .sort({ score: -1 })
    .limit(5)
    .select("displayQuery query");

  const related = relatedRaw.map((r) => r.displayQuery || r.query);

  res.json({
    success: true,
    data: {
      query: q,
      enhancedQuery: enhanced !== q.toLowerCase() ? enhanced : null,
      platform,
      category,
      contentType,
      results,
      total: results.length,
      related,
      // ✅ Bug 8 Fixed: .substr() → .substring()
      searchId:
        Date.now().toString(36) + Math.random().toString(36).substring(2),
      timestamp: new Date(),
    },
  });
});

// ─── GET /api/search/suggestions ─────────────────────────────────────────────
exports.getSuggestions = asyncHandler(async (req, res) => {
  const { q = "", limit = 10 } = req.query;
  if (!q.trim()) return res.json({ success: true, data: { suggestions: [] } });

  const cacheKey = `suggestions:${normalizeQuery(q)}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ success: true, data: { suggestions: cached } });

  const [trending, history] = await Promise.all([
    Trending.find({ query: { $regex: "^" + normalizeQuery(q), $options: "i" } })
      .sort({ score: -1 })
      .limit(8)
      .select("displayQuery query score count"),
    req.user
      ? SearchHistory.find({
          user: req.user._id,
          normalizedQuery: { $regex: normalizeQuery(q), $options: "i" },
        })
          .sort({ createdAt: -1 })
          .limit(5)
          .select("query platform")
      : Promise.resolve([]),
  ]);

  const suggestions = [
    ...history.map((h) => ({
      query: h.query,
      platform: h.platform,
      type: "history",
      icon: "↩",
    })),
    ...trending.map((t) => ({
      query: t.displayQuery || t.query,
      count: t.count,
      type: "trending",
      icon: t.score > 500 ? "🔥" : "📈",
    })),
  ].slice(0, parseInt(limit));

  cache.set(cacheKey, suggestions, 60);
  res.json({ success: true, data: { suggestions } });
});

// ─── GET /api/search/trending ─────────────────────────────────────────────────
exports.getTrending = asyncHandler(async (req, res) => {
  const { limit = 20, period = "all", category } = req.query;
  const sortField =
    period === "daily"
      ? "dailyCount"
      : period === "weekly"
        ? "weeklyCount"
        : "score";
  const filter = category ? { category } : {};

  const cacheKey = `trending:${period}:${category || "all"}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ success: true, data: { trending: cached } });

  const trending = await Trending.find(filter)
    .sort({ [sortField]: -1 })
    .limit(parseInt(limit))
    .select(
      "displayQuery query count dailyCount weeklyCount score category lastSearched",
    );

  cache.set(cacheKey, trending, 120);
  res.json({ success: true, data: { trending, period } });
});

// ─── POST /api/search/click ───────────────────────────────────────────────────
exports.recordClick = asyncHandler(async (req, res) => {
  const { searchId, platform, query } = req.body;
  if (req.user && query) {
    await SearchHistory.findOneAndUpdate(
      {
        user: req.user._id,
        query,
        createdAt: { $gte: new Date(Date.now() - 60000) },
      },
      { $addToSet: { clickedPlatforms: platform } },
    );
  }
  res.json({ success: true });
});

// ─── GET /api/search/stats ────────────────────────────────────────────────────
exports.getSearchStats = asyncHandler(async (req, res) => {
  const cacheKey = "global:stats";
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ success: true, data: cached });

  const [totalSearches, uniqueQueries, topPlatform] = await Promise.all([
    SearchHistory.countDocuments(),
    Trending.countDocuments(),
    Trending.findOne().sort({ count: -1 }).select("displayQuery count"),
  ]);

  const stats = {
    totalSearches,
    uniqueQueries,
    platforms: PLATFORMS.length,
    topQuery: topPlatform?.displayQuery,
  };
  cache.set(cacheKey, stats, 300);
  res.json({ success: true, data: stats });
});

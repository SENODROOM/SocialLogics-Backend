/**
 * recommendationsController.js
 * Handles GET /api/recommendations
 */
const { fetchRecommendations } = require("../utils/recommendations");
const { cache } = require("../utils/cache");
const { asyncHandler } = require("../middleware");

/**
 * GET /api/recommendations
 * Query params:
 *   q        - search query (required)
 *   platform - 'all' | comma-separated platform IDs (default: 'all')
 *   limit    - items per platform (default: 8, max: 12)
 *   type     - 'flat' | 'byPlatform' (default: 'flat')
 */
exports.getRecommendations = asyncHandler(async (req, res) => {
  const { q = "", platform = "all", limit = "8", type = "flat" } = req.query;

  if (!q.trim()) {
    return res
      .status(400)
      .json({ success: false, error: "Query param `q` is required" });
  }

  const limitNum = Math.min(parseInt(limit) || 8, 12);
  const platforms =
    platform === "all" ? "all" : platform.split(",").map((s) => s.trim());

  const cacheKey = `recs:${q.toLowerCase().trim()}:${platform}:${limitNum}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ success: true, cached: true, data: cached });
  }

  const { byPlatform, flat } = await fetchRecommendations(
    q.trim(),
    platforms,
    limitNum,
  );

  const data = {
    query: q.trim(),
    platform,
    total: flat.length,
    flat,
    byPlatform,
    fetchedAt: new Date().toISOString(),
  };

  // Cache for 5 minutes
  cache.set(cacheKey, data, 300);

  res.json({ success: true, cached: false, data });
});

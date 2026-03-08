/**
 * backend/controllers/recommendationsController.js
 * Handles GET /api/recommendations
 *
 * Query params:
 *   q        - search query (required)
 *   platform - 'all' | comma-separated platform IDs (default: 'all')
 *   limit    - items per platform (default: 12, max: 15)
 *   page     - page number for infinite scroll (default: 1)
 */
const { fetchRecommendations } = require("../utils/recommendations");
const { cache } = require("../utils/cache");
const { asyncHandler } = require("../middleware");

exports.getRecommendations = asyncHandler(async (req, res) => {
  const { q = "", platform = "all", limit = "12", page = "1" } = req.query;

  if (!q.trim()) {
    return res
      .status(400)
      .json({ success: false, error: "Query param `q` is required" });
  }

  const limitNum = Math.min(parseInt(limit) || 12, 15);
  const pageNum = Math.max(parseInt(page) || 1, 1);
  const platforms =
    platform === "all" ? "all" : platform.split(",").map((s) => s.trim());

  // Cache key includes page so each page is cached independently
  const cacheKey = `recs:${q.toLowerCase().trim()}:${platform}:${limitNum}:p${pageNum}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ success: true, cached: true, data: cached });
  }

  const { byPlatform, flat } = await fetchRecommendations(
    q.trim(),
    platforms,
    limitNum,
    pageNum,
  );

  const data = {
    query: q.trim(),
    platform,
    page: pageNum,
    total: flat.length,
    flat,
    byPlatform,
    fetchedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, data, 300);

  res.json({ success: true, cached: false, data });
});

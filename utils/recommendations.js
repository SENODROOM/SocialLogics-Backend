/**
 * backend/utils/recommendations.js
 *
 * Fetches real content previews from platforms using public APIs
 * (no API keys — YouTube RSS, Reddit JSON, Dailymotion API, Vimeo RSS)
 *
 * Supports `page` param: each page uses a varied query so results are
 * always fresh and different — enabling true infinite scroll.
 */
const axios = require("axios");

const http = axios.create({
  timeout: 8000,
  headers: {
    "User-Agent": "SocialLogics/2.0 (content aggregator)",
    Accept: "application/json, application/rss+xml, text/xml",
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const safeGet = async (url, opts = {}) => {
  try {
    const res = await http.get(url, opts);
    return res.data;
  } catch {
    return null;
  }
};

const parseXmlItems = (xml, count = 15) => {
  if (!xml || typeof xml !== "string") return [];
  const items = [];
  const itemRegex = /<entry>([\s\S]*?)<\/entry>|<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < count) {
    items.push(match[1] || match[2]);
  }
  return items;
};

const extractTag = (str, tag) => {
  const m = str.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
};

const extractAttr = (str, tag, attr) => {
  const m = str.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i"));
  return m ? m[1] : "";
};

const timeAgo = (date) => {
  if (!date) return "";
  const secs = Math.floor((Date.now() - new Date(date)) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

const fmtNum = (n) => {
  if (!n) return "";
  const num = typeof n === "string" ? parseInt(n.replace(/,/g, "")) : n;
  if (isNaN(num)) return "";
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(0)}K`;
  return num.toString();
};

/**
 * Generate query variations for a given page number.
 * Page 1 = base query, subsequent pages add modifiers so APIs
 * return different result sets — this is how we fake infinite scroll
 * against APIs that don't support cursor/offset pagination.
 */
const getPageQuery = (baseQuery, page) => {
  const modifiers = [
    "", // page 1 — original
    "best",
    "top",
    "2024",
    "2025",
    "trending",
    "viral",
    "popular",
    "new",
    "latest",
    "compilation",
    "highlights",
    "explained",
    "reaction",
    "review",
    "tutorial",
    "full",
    "official",
    "live",
    "behind the scenes",
  ];
  const mod = modifiers[(page - 1) % modifiers.length] || page.toString();
  return mod ? `${baseQuery} ${mod}`.trim() : baseQuery;
};

// ── YouTube ───────────────────────────────────────────────────────────────────

const fetchYouTube = async (query, limit = 15) => {
  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(query)}`;
    const xml = await safeGet(feedUrl, {
      responseType: "text",
      headers: { Accept: "text/xml,application/xml" },
    });
    if (!xml) return [];

    const items = parseXmlItems(xml, limit);
    return items
      .map((item) => {
        const videoId =
          extractAttr(item, "yt:videoId", "") ||
          (extractTag(item, "yt:videoId") || extractTag(item, "id")).replace(
            /.*:video:/,
            "",
          );
        const title = extractTag(item, "title") || extractTag(item, "name");
        const author = extractTag(item, "name") || extractTag(item, "author");
        const published =
          extractTag(item, "published") || extractTag(item, "updated");
        const viewCount =
          extractTag(item, "yt:viewCount") ||
          extractTag(item, "media:statistics");

        if (!videoId || !title) return null;

        return {
          id: `yt_${videoId}`,
          platform: "youtube",
          type: "video",
          title: title.substring(0, 100),
          author,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          thumbnailHq: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`,
          duration: null,
          views: fmtNum(viewCount),
          publishedAt: published,
          timeAgo: timeAgo(published),
          previewable: true,
          videoId,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

// ── Reddit ────────────────────────────────────────────────────────────────────

const fetchReddit = async (query, limit = 15, after = "") => {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&type=link&sort=relevance&limit=${limit * 2}${after ? `&after=${after}` : ""}`;
    const data = await safeGet(url, {
      headers: { Accept: "application/json" },
    });
    if (!data?.data?.children) return [];

    return data.data.children
      .filter((c) => {
        const p = c.data;
        return (
          p.is_video ||
          p.preview?.images?.length > 0 ||
          p.thumbnail?.startsWith("http")
        );
      })
      .slice(0, limit)
      .map((c) => {
        const p = c.data;
        const thumb =
          p.preview?.images?.[0]?.resolutions?.[2]?.url?.replace(
            /&amp;/g,
            "&",
          ) ||
          p.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&") ||
          (p.thumbnail?.startsWith("http") ? p.thumbnail : null);
        const redditVideoUrl =
          p.media?.reddit_video?.fallback_url ||
          p.secure_media?.reddit_video?.fallback_url;

        return {
          id: `rd_${p.id}`,
          platform: "reddit",
          type: p.is_video ? "video" : "post",
          title: (p.title || "").substring(0, 100),
          author: `u/${p.author}`,
          subreddit: `r/${p.subreddit}`,
          thumbnail: thumb,
          url: `https://www.reddit.com${p.permalink}`,
          embedUrl: redditVideoUrl || null,
          views: null,
          votes: fmtNum(p.score),
          comments: fmtNum(p.num_comments),
          publishedAt: new Date(p.created_utc * 1000).toISOString(),
          timeAgo: timeAgo(new Date(p.created_utc * 1000)),
          previewable: !!redditVideoUrl,
          videoId: p.id,
        };
      });
  } catch {
    return [];
  }
};

// ── Vimeo ─────────────────────────────────────────────────────────────────────

const fetchVimeo = async (query, limit = 10) => {
  try {
    const xml = await safeGet(
      `https://vimeo.com/search?q=${encodeURIComponent(query)}&format=rss`,
      { responseType: "text" },
    );
    if (!xml) return [];

    const items = parseXmlItems(xml, limit);
    return items
      .map((item) => {
        const link = extractTag(item, "link");
        const title = extractTag(item, "title");
        const thumbnail =
          extractAttr(item, "media:thumbnail", "url") ||
          extractAttr(item, "enclosure", "url");
        const videoId = link?.match(/vimeo\.com\/(\d+)/)?.[1];
        if (!videoId || !title) return null;

        return {
          id: `vm_${videoId}`,
          platform: "vimeo",
          type: "video",
          title: title.substring(0, 100),
          author: extractTag(item, "dc:creator") || extractTag(item, "author"),
          thumbnail: thumbnail || `https://vumbnail.com/${videoId}.jpg`,
          url: `https://vimeo.com/${videoId}`,
          embedUrl: `https://player.vimeo.com/video/${videoId}?autoplay=1&muted=1`,
          timeAgo: timeAgo(extractTag(item, "pubDate")),
          previewable: true,
          videoId,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

// ── Dailymotion ───────────────────────────────────────────────────────────────

const fetchDailymotion = async (query, limit = 10, page = 1) => {
  try {
    const data = await safeGet(
      `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}&limit=${limit}&page=${page}&fields=id,title,thumbnail_240_url,url,created_time,views_total,owner.screenname`,
    );
    if (!data?.list) return [];

    return data.list.map((v) => ({
      id: `dm_${v.id}`,
      platform: "dailymotion",
      type: "video",
      title: (v.title || "").substring(0, 100),
      author: v["owner.screenname"] || "",
      thumbnail: v.thumbnail_240_url,
      url: v.url || `https://www.dailymotion.com/video/${v.id}`,
      embedUrl: `https://www.dailymotion.com/embed/video/${v.id}?autoplay=1&mute=1`,
      views: fmtNum(v.views_total),
      timeAgo: timeAgo(new Date(v.created_time * 1000)),
      previewable: true,
      videoId: v.id,
    }));
  } catch {
    return [];
  }
};

// ── Twitch / TikTok / Instagram (no public API — static search cards) ─────────

const generateTwitchItems = (query) => [
  {
    id: `tw_search_${query.replace(/\s+/g, "_")}`,
    platform: "twitch",
    type: "live",
    title: `Search "${query}" on Twitch`,
    author: "Twitch",
    thumbnail: null,
    url: `https://www.twitch.tv/search?term=${encodeURIComponent(query)}`,
    embedUrl: null,
    timeAgo: "Live now",
    previewable: false,
    isSearchCard: true,
  },
];

const generateTikTokItems = (query) => [
  {
    id: `tt_search_${query.replace(/\s+/g, "_")}`,
    platform: "tiktok",
    type: "short",
    title: `Trending "${query}" on TikTok`,
    author: "TikTok",
    thumbnail: null,
    url: `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`,
    embedUrl: null,
    timeAgo: "Trending",
    previewable: false,
    isSearchCard: true,
  },
];

const generateInstagramItems = (query) => [
  {
    id: `ig_search_${query.replace(/\s+/g, "_")}`,
    platform: "instagram",
    type: "reel",
    title: `Explore #${query.replace(/\s+/g, "")} on Instagram`,
    author: "Instagram",
    thumbnail: null,
    url: `https://www.instagram.com/explore/tags/${encodeURIComponent(query.replace(/ /g, ""))}/`,
    embedUrl: null,
    timeAgo: "Now",
    previewable: false,
    isSearchCard: true,
  },
];

// ── Master fetcher ────────────────────────────────────────────────────────────

/**
 * Fetch recommendations for a query across platforms.
 *
 * @param {string}          query
 * @param {string|string[]} platforms        - 'all' or array of platform IDs
 * @param {number}          limitPerPlatform - items per platform (default 12)
 * @param {number}          page             - page number for infinite scroll (default 1)
 *
 * Each page uses a varied query so the APIs return different result sets.
 * Dailymotion supports real page params natively.
 * YouTube/Reddit/Vimeo get query modifiers per page.
 */
const fetchRecommendations = async (
  query,
  platforms = "all",
  limitPerPlatform = 12,
  page = 1,
) => {
  const ALL_PLATFORMS = [
    "youtube",
    "reddit",
    "vimeo",
    "dailymotion",
    "twitch",
    "tiktok",
    "instagram",
  ];

  const targets =
    platforms === "all"
      ? ALL_PLATFORMS
      : (Array.isArray(platforms) ? platforms : [platforms]).filter((p) =>
          ALL_PLATFORMS.includes(p),
        );

  // Build a varied query for this page so APIs return fresh results
  const pagedQuery = getPageQuery(query, page);

  const results = await Promise.allSettled(
    targets.map(async (pid) => {
      let items = [];

      if (pid === "youtube")
        items = await fetchYouTube(pagedQuery, limitPerPlatform);
      else if (pid === "reddit")
        items = await fetchReddit(pagedQuery, limitPerPlatform);
      else if (pid === "vimeo")
        items = await fetchVimeo(pagedQuery, limitPerPlatform);
      else if (pid === "dailymotion")
        items = await fetchDailymotion(pagedQuery, limitPerPlatform, page);
      else if (pid === "twitch") items = generateTwitchItems(pagedQuery);
      else if (pid === "tiktok") items = generateTikTokItems(pagedQuery);
      else if (pid === "instagram") items = generateInstagramItems(pagedQuery);

      // Stamp items with page so frontend can dedupe across pages
      items = items.map((item) => ({ ...item, _page: page }));

      return { platform: pid, items };
    }),
  );

  const byPlatform = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.items.length > 0) {
      byPlatform[r.value.platform] = r.value.items;
    }
  }

  // Interleaved flat list (round-robin across platforms)
  const flat = [];
  const platformArrays = Object.values(byPlatform);
  const maxLen = Math.max(...platformArrays.map((a) => a.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const arr of platformArrays) {
      if (arr[i]) flat.push(arr[i]);
    }
  }

  return { byPlatform, flat };
};

module.exports = { fetchRecommendations };

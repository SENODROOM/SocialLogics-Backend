/**
 * recommendations.js
 * Fetches real content previews from platforms using public APIs
 * (no API keys required — uses YouTube RSS, Reddit JSON, oEmbed endpoints)
 */
const axios = require("axios");

const http = axios.create({
  timeout: 8000,
  headers: {
    "User-Agent": "SocialLogics/2.0 (content aggregator)",
    Accept: "application/json, application/rss+xml, text/xml",
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const safeGet = async (url, opts = {}) => {
  try {
    const res = await http.get(url, opts);
    return res.data;
  } catch {
    return null;
  }
};

const parseXmlItems = (xml, count = 8) => {
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

// ── YouTube ───────────────────────────────────────────────────────────────────
// Uses YouTube search RSS (no API key) + Data API v3 thumbnail URLs

const fetchYouTube = async (query, limit = 8) => {
  try {
    // YouTube search RSS feed (public, no API key)
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
// Public Reddit JSON API (no auth, no key)

const fetchReddit = async (query, limit = 8) => {
  try {
    const data = await safeGet(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&type=link&sort=relevance&limit=${limit * 2}`,
      { headers: { Accept: "application/json" } },
    );
    if (!data?.data?.children) return [];

    return data.data.children
      .filter((c) => {
        const p = c.data;
        // Only include posts with video/image previews
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

        // Reddit video embed
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

// ── Vimeo oEmbed ──────────────────────────────────────────────────────────────
const fetchVimeo = async (query, limit = 6) => {
  try {
    // Vimeo public search RSS
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
const fetchDailymotion = async (query, limit = 6) => {
  try {
    const data = await safeGet(
      `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}&limit=${limit}&fields=id,title,thumbnail_240_url,url,created_time,views_total,owner.screenname`,
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

// ── Twitch clips (public) ─────────────────────────────────────────────────────
// Twitch public embed (no auth for embed, only clip preview available without API key)
const generateTwitchItems = (query, limit = 4) => {
  // Synthetic — Twitch requires API key for search. Provide search links as cards.
  return [
    {
      id: `tw_search_${Date.now()}`,
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
};

// ── TikTok (no public API without auth — provide search deep link) ────────────
const generateTikTokItems = (query) => [
  {
    id: `tt_search_${Date.now()}`,
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

// ── Instagram (no public search API) ─────────────────────────────────────────
const generateInstagramItems = (query) => [
  {
    id: `ig_search_${Date.now()}`,
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

const PLATFORM_MAP = {
  youtube: fetchYouTube,
  reddit: fetchReddit,
  vimeo: fetchVimeo,
  dailymotion: fetchDailymotion,
  twitch: (q) => generateTwitchItems(q),
  tiktok: (q) => generateTikTokItems(q),
  instagram: (q) => generateInstagramItems(q),
};

/**
 * Fetch recommendations for a query across specified platforms.
 * @param {string} query
 * @param {string|string[]} platforms - 'all' or array of platform IDs
 * @param {number} limitPerPlatform
 */
const fetchRecommendations = async (
  query,
  platforms = "all",
  limitPerPlatform = 8,
) => {
  const targets =
    platforms === "all"
      ? Object.keys(PLATFORM_MAP)
      : (Array.isArray(platforms) ? platforms : [platforms]).filter(
          (p) => PLATFORM_MAP[p],
        );

  const results = await Promise.allSettled(
    targets.map(async (pid) => {
      const fn = PLATFORM_MAP[pid];
      const items = await fn(query, limitPerPlatform);
      return { platform: pid, items: items || [] };
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

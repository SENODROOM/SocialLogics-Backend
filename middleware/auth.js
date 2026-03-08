/**
 * backend/routes/auth.js
 *
 * Handles:
 *  - POST /api/auth/register  — email/password register
 *  - POST /api/auth/login     — email/password login
 *  - GET  /api/auth/me        — get current user
 *  - PUT  /api/auth/profile   — update profile
 *  - PUT  /api/auth/change-password
 *  - GET  /api/auth/google    — start Google OAuth
 *  - GET  /api/auth/google/callback
 *  - GET  /api/auth/facebook  — start Facebook OAuth
 *  - GET  /api/auth/facebook/callback
 *  - GET  /api/auth/instagram — start Instagram OAuth
 *  - GET  /api/auth/instagram/callback
 *
 * SETUP:
 *  npm install passport passport-google-oauth20 passport-facebook passport-instagram
 *
 *  Add to .env:
 *    GOOGLE_CLIENT_ID=...
 *    GOOGLE_CLIENT_SECRET=...
 *    FACEBOOK_APP_ID=...
 *    FACEBOOK_APP_SECRET=...
 *    INSTAGRAM_CLIENT_ID=...
 *    INSTAGRAM_CLIENT_SECRET=...
 *    FRONTEND_URL=http://localhost:3000
 */

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const FacebookStrategy = require("passport-facebook").Strategy;
const InstagramStrategy = require("passport-instagram").Strategy;
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

/* ─── Passport setup ─────────────────────────────────────────────────────── */

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select("-password");
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

/**
 * Find or create a user from OAuth profile.
 * Links by email if an account already exists.
 */
async function findOrCreateOAuthUser({
  provider,
  providerId,
  email,
  displayName,
  avatar,
}) {
  // 1. Try to find by provider-specific ID
  let user = await User.findOne({ [`oauth.${provider}.id`]: providerId });
  if (user) return user;

  // 2. Try to link to existing account by email
  if (email) {
    user = await User.findOne({ email });
    if (user) {
      user.oauth = user.oauth || {};
      user.oauth[provider] = { id: providerId };
      if (avatar && !user.avatar) user.avatar = avatar;
      await user.save();
      return user;
    }
  }

  // 3. Create new account
  const username = await generateUniqueUsername(
    displayName || email?.split("@")[0] || provider + "_user",
  );
  user = await User.create({
    username,
    email: email || `${provider}_${providerId}@sociallogics.app`,
    password: Math.random().toString(36) + Math.random().toString(36), // random unusable password
    avatar: avatar || "",
    oauth: { [provider]: { id: providerId } },
  });
  return user;
}

async function generateUniqueUsername(base) {
  const slug = base.replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 20);
  let username = slug;
  let i = 1;
  while (await User.findOne({ username })) {
    username = `${slug}_${i++}`;
  }
  return username;
}

/* ─── Google Strategy ─────────────────────────────────────────────────────── */
if (process.env.GOOGLE_CLIENT_ID) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${BACKEND_URL}/api/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const user = await findOrCreateOAuthUser({
            provider: "google",
            providerId: profile.id,
            email: profile.emails?.[0]?.value,
            displayName: profile.displayName,
            avatar: profile.photos?.[0]?.value,
          });
          done(null, user);
        } catch (err) {
          done(err, null);
        }
      },
    ),
  );
}

/* ─── Facebook Strategy ───────────────────────────────────────────────────── */
if (process.env.FACEBOOK_APP_ID) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: `${BACKEND_URL}/api/auth/facebook/callback`,
        profileFields: ["id", "displayName", "emails", "photos"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const user = await findOrCreateOAuthUser({
            provider: "facebook",
            providerId: profile.id,
            email: profile.emails?.[0]?.value,
            displayName: profile.displayName,
            // Facebook profile picture — use the graph API URL for high quality
            avatar: `https://graph.facebook.com/${profile.id}/picture?type=large`,
          });
          done(null, user);
        } catch (err) {
          done(err, null);
        }
      },
    ),
  );
}

/* ─── Instagram Strategy ──────────────────────────────────────────────────── */
if (process.env.INSTAGRAM_CLIENT_ID) {
  passport.use(
    new InstagramStrategy(
      {
        clientID: process.env.INSTAGRAM_CLIENT_ID,
        clientSecret: process.env.INSTAGRAM_CLIENT_SECRET,
        callbackURL: `${BACKEND_URL}/api/auth/instagram/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const user = await findOrCreateOAuthUser({
            provider: "instagram",
            providerId: profile.id,
            email: null, // Instagram Basic Display API doesn't give email
            displayName: profile.displayName || profile.username,
            avatar: profile._json?.profile_picture || "",
          });
          done(null, user);
        } catch (err) {
          done(err, null);
        }
      },
    ),
  );
}

/* ─── OAuth success handler (shared) ─────────────────────────────────────── */
const oauthSuccess = (req, res) => {
  if (!req.user) {
    return res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
  }
  const token = generateToken(req.user._id);
  // Redirect to frontend with token in URL — frontend reads it and stores in localStorage
  res.redirect(`${FRONTEND_URL}/oauth-callback?token=${token}`);
};

/* ─── OAuth routes ────────────────────────────────────────────────────────── */

// Google
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }),
);
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${FRONTEND_URL}/login?error=google_failed`,
    session: false,
  }),
  oauthSuccess,
);

// Facebook
router.get(
  "/facebook",
  passport.authenticate("facebook", {
    scope: ["email", "public_profile"],
    session: false,
  }),
);
router.get(
  "/facebook/callback",
  passport.authenticate("facebook", {
    failureRedirect: `${FRONTEND_URL}/login?error=facebook_failed`,
    session: false,
  }),
  oauthSuccess,
);

// Instagram
router.get(
  "/instagram",
  passport.authenticate("instagram", { session: false }),
);
router.get(
  "/instagram/callback",
  passport.authenticate("instagram", {
    failureRedirect: `${FRONTEND_URL}/login?error=instagram_failed`,
    session: false,
  }),
  oauthSuccess,
);

/* ─── Email/password routes ───────────────────────────────────────────────── */

// POST /api/auth/register
router.post(
  "/register",
  [
    body("username")
      .trim()
      .isLength({ min: 3, max: 30 })
      .withMessage("Username must be 3-30 chars"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("password").isLength({ min: 6 }).withMessage("Password min 6 chars"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { username, email, password } = req.body;
    try {
      const exists = await User.findOne({ $or: [{ email }, { username }] });
      if (exists)
        return res
          .status(400)
          .json({
            error:
              exists.email === email
                ? "Email already in use"
                : "Username taken",
          });

      const user = await User.create({ username, email, password });
      res
        .status(201)
        .json({
          success: true,
          data: { token: generateToken(user._id), user: user.toPublic() },
        });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /api/auth/login
router.post(
  "/login",
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user || !(await user.matchPassword(password)))
        return res.status(401).json({ error: "Invalid email or password" });

      user.lastLogin = new Date();
      await user.save();
      res.json({
        success: true,
        data: { token: generateToken(user._id), user: user.toPublic() },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/auth/me
router.get("/me", protect, (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

// PUT /api/auth/profile
router.put("/profile", protect, async (req, res) => {
  const {
    bio,
    preferredPlatforms,
    theme,
    avatar,
    safeSearch,
    defaultSearchMode,
  } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { bio, preferredPlatforms, theme, avatar, safeSearch, defaultSearchMode },
      { new: true, runValidators: true },
    ).select("-password");
    res.json({ success: true, data: { user } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/change-password
router.put("/change-password", protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const user = await User.findById(req.user._id);
    if (!(await user.matchPassword(currentPassword)))
      return res.status(400).json({ error: "Current password is incorrect" });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, passport };

/**
 * backend/models/User.js
 * Updated to support OAuth (Google, Facebook, Instagram) alongside email/password.
 */
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // Password is optional for OAuth-only accounts (set to random unusable value)
    password: { type: String, required: true, minlength: 6 },
    avatar: { type: String, default: "" },
    bio: { type: String, default: "", maxlength: 300 },

    // OAuth provider IDs — allows linking multiple providers to one account
    oauth: {
      google: { id: String },
      facebook: { id: String },
      instagram: { id: String },
    },

    preferredPlatforms: [{ type: String }],
    theme: {
      type: String,
      enum: ["dark", "cyber", "neon", "matrix"],
      default: "cyber",
    },
    safeSearch: { type: Boolean, default: true },
    defaultSearchMode: { type: String, default: "all" },

    savedSearches: [
      {
        query: String,
        platform: String,
        label: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    role: { type: String, enum: ["user", "admin"], default: "user" },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date, default: Date.now },
    loginStreak: { type: Number, default: 0 },
    searchCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Hash password before saving — skip if unchanged
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = async function (entered) {
  return await bcrypt.compare(entered, this.password);
};

userSchema.methods.toPublic = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model("User", userSchema);

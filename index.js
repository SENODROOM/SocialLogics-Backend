require("dotenv").config();
const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const connectDB = require("./config/db");
const logger = require("./config/logger");
const { apiLimiter, errorHandler } = require("./middleware");
const routes = require("./routes");
const fs = require("fs");
if (!fs.existsSync("logs")) fs.mkdirSync("logs");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(
  cors({
    origin: [
      process.env.CLIENT_URL || "http://localhost:3000",
      "http://localhost:3001",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== "test") {
  app.use(
    morgan("dev", { stream: { write: (msg) => logger.info(msg.trim()) } }),
  );
}
app.use("/api/", apiLimiter);
app.use("/api", routes);
app.get("/api/health", (req, res) =>
  res.json({
    success: true,
    status: "healthy",
    version: "2.0.0",
    uptime: process.uptime(),
    timestamp: new Date(),
  }),
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/build")));
  app.get("*", (req, res) =>
    res.sendFile(path.resolve(__dirname, "../frontend/build/index.html")),
  );
}
app.use((req, res) =>
  res.status(404).json({ success: false, error: "Not found" }),
);
app.use(errorHandler);
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled:", err);
  process.exit(1);
});
const PORT = process.env.PORT || 5000;
connectDB().then(() =>
  app.listen(PORT, () => logger.info(`🚀 SocialLogics v2 on :${PORT}`)),
);
module.exports = app;

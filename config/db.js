const mongoose = require('mongoose');
const logger = require('./logger');

const connectDB = async () => {
  const opts = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  };
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, opts);
    logger.info(`MongoDB connected: ${conn.connection.host}`);
    mongoose.connection.on('error', err => logger.error('MongoDB error:', err));
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;

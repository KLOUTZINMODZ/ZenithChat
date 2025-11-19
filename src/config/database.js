const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');


    try {
      const masked = uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:****@');
      logger.info(`MongoDB connecting to: ${masked}`);
    } catch {}

    const options = {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 30000,
      socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS) || 60000,
      connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS) || 30000,
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 100,
      minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE) || 10,
      maxIdleTimeMS: Number(process.env.MONGODB_MAX_IDLE_TIME_MS) || 30000,
      compressors: ['zlib'],
      zlibCompressionLevel: 6,
      ...(process.env.MONGODB_DBNAME ? { dbName: process.env.MONGODB_DBNAME } : {})
    };

    const conn = await mongoose.connect(uri, options);

    logger.info(`MongoDB Connected: ${conn.connection.host}`);


    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    return conn;
  } catch (error) {
    logger.error('Error connecting to MongoDB:', error);
    logger.error('MongoDB URI format should be: mongodb+srv://username:password@cluster.mongodb.net/database');
    logger.error('Check MONGODB_URI environment variable and MongoDB server status.');

    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    throw error;
  }
};

module.exports = connectDB;

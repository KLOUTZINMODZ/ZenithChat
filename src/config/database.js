const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {

    const conn = await mongoose.connect(process.env.MONGODB_URI);

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
    

    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    throw error;
  }
};

module.exports = connectDB;

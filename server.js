require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const WebSocketServer = require('./src/websocket/WebSocketServer');
const connectDB = require('./src/config/database');
const logger = require('./src/utils/logger');
const messageRoutes = require('./src/routes/messageRoutes');
const authRoutes = require('./src/routes/authRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const marketplaceWebhookRoutes = require('./src/routes/marketplaceWebhookRoutes');
const boostingChatRoutes = require('./src/routes/boostingChatRoutes');
const agreementRoutes = require('./src/routes/agreementRoutes');
const compatibilityRoutes = require('./src/routes/compatibilityRoutes');
const temporaryChatRoutes = require('./src/routes/temporaryChatRoutes');
const proposalRoutes = require('./src/routes/proposalRoutes');
const routeAwareCacheRoutes = require('./src/routes/routeAwareCacheRoutes');
const cache = require('./src/services/GlobalCache');
const temporaryChatCleanupService = require('./src/services/temporaryChatCleanupService');


const app = express();

app.set('trust proxy', 1);
const server = http.createServer(app);


connectDB();


app.use(helmet());
app.use(compression());


const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://hacklotesite.vercel.app',
      'https://hacklote-front.vercel.app',
      'https://zenith.enrelyugi.com.br'
    ];
    

    if (!origin) {
      callback(null, true);
      return;
    }
    

    if (allowedOrigins.includes(origin) || 
        origin.includes('localhost') || 
        origin.includes('127.0.0.1') ||
        origin.includes('ngrok')) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'ngrok-skip-browser-warning']
};
app.use(cors(corsOptions));


app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.url.includes('boosting-chat')) {
    console.log('🔍 Boosting chat request:', req.method, req.url);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
  }
  next();
});


app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);


app.get('/', (req, res) => {
  res.json({
    name: 'HackLote Chat API',
    version: '1.0.0',
    status: 'running',
    description: 'WebSocket-based real-time messaging API for HackLote marketplace',
    endpoints: {
      health: 'GET /health',
      auth: {
        validate: 'POST /api/auth/validate',
        wsToken: 'GET /api/auth/ws-token'
      },
      messages: {
        conversations: 'GET /api/messages/conversations',
        messages: 'GET /api/messages/conversations/:id/messages',
        send: 'POST /api/messages/conversations/:id/messages',
        create: 'POST /api/messages/conversations',
        markRead: 'PUT /api/messages/conversations/:id/read',
        delete: 'DELETE /api/messages/:id'
      },
      websocket: {
        url: (process.env.CHAT_PUBLIC_BASE_URL
          ? `${process.env.CHAT_PUBLIC_BASE_URL
              .replace(/^http:/, 'ws:')
              .replace(/^https:/, 'wss:')
              .replace(/\/$/, '')}/ws`
          : `${req.secure ? 'wss' : 'ws'}://${req.get('host')}/ws`),
        authentication: 'JWT token required in query parameter: ?token=YOUR_JWT_TOKEN'
      }
    },
    timestamp: new Date().toISOString()
  });
});


app.get('/health', (req, res) => {
  const cacheStats = cache.getStats();
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV,
    cache: cacheStats
  });
});


const cacheRoutes = require('./src/routes/cacheRoutes');
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/marketplace-webhook', marketplaceWebhookRoutes);
app.use('/api/boosting-chat', boostingChatRoutes);
app.use('/api/boosting-chat', temporaryChatRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/route-cache', routeAwareCacheRoutes);


console.log('🔍 Rotas registradas:');
app._router.stack.forEach((middleware) => {
  if (middleware.route) {
    console.log(`  ${Object.keys(middleware.route.methods)} ${middleware.route.path}`);
  } else if (middleware.name === 'router') {
    middleware.handle.stack.forEach((handler) => {
      if (handler.route) {
        console.log(`  ${Object.keys(handler.route.methods)} ${middleware.regexp.source.replace('\\/?', '').replace('(?=\\/|$)', '')}${handler.route.path}`);
      }
    });
  }
});
app.use('/api/cache', cacheRoutes);

app.use('/api', compatibilityRoutes);


app.get('/api/ws-info', (req, res) => {
  const wsUrl = process.env.CHAT_PUBLIC_BASE_URL
    ? `${process.env.CHAT_PUBLIC_BASE_URL
        .replace(/^http:/, 'ws:')
        .replace(/^https:/, 'wss:')
        .replace(/\/$/, '')}/ws`
    : `${req.secure ? 'wss' : 'ws'}://${req.get('host')}/ws`;
  res.json({
    url: wsUrl,
    protocol: wsUrl.startsWith('wss') ? 'wss' : 'ws',
    version: '1.0.0',
    features: ['real-time-messaging', 'typing-indicators', 'read-receipts', 'file-sharing']
  });
});


app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});


app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});


const wsServer = new WebSocketServer(server);


app.locals.notificationService = wsServer.notificationService;


process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    wsServer.close();
    cache.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    wsServer.close();
    cache.close();
    process.exit(0);
  });
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`🚀 Chat API Server running on port ${PORT}`);
  logger.info(`🔌 WebSocket server ready for connections`);
  logger.info(`📝 Environment: ${process.env.NODE_ENV}`);
  logger.info(`🔗 Allowed origins: ${process.env.ALLOWED_ORIGINS}`);
  

  temporaryChatCleanupService.start();
});

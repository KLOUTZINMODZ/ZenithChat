require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const WebSocketServer = require('./src/websocket/WebSocketServer');
const connectDB = require('./src/config/database');
const logger = require('./src/utils/logger');
const messageRoutes = require('./src/routes/messageRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const authRoutes = require('./src/routes/authRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const marketplaceWebhookRoutes = require('./src/routes/marketplaceWebhookRoutes');
const boostingChatRoutes = require('./src/routes/boostingChatRoutes');
const agreementRoutes = require('./src/routes/agreementRoutes');
const compatibilityRoutes = require('./src/routes/compatibilityRoutes');
const temporaryChatRoutes = require('./src/routes/temporaryChatRoutes');
const proposalRoutes = require('./src/routes/proposalRoutes');
const offlineRoutes = require('./src/routes/offlineRoutes');
const cache = require('./src/services/GlobalCache');
const walletRoutes = require('./src/routes/walletRoutes');
const temporaryChatCleanupService = require('./src/services/temporaryChatCleanupService');
const purchasesRoutes = require('./src/routes/purchasesRoutes');
const supportRoutes = require('./src/routes/supportRoutes');
const userRoutes = require('./src/routes/userRoutes');
const purchaseAutoReleaseService = require('./src/services/purchaseAutoReleaseService');
const mongoose = require('mongoose');
const adminRoutes = require('./src/routes/adminRoutes');
const qaRoutes = require('./src/routes/qaRoutes');
const aiSupportRoutes = require('./src/routes/aiSupportRoutes');
const ratingsRoutes = require('./src/routes/ratingsRoutes');
const achievementRoutes = require('./src/routes/achievementRoutes');
const emailVerificationRoutes = require('./src/routes/emailVerificationRoutes');
const imageServeMiddleware = require('./src/middleware/imageServeMiddleware');

const app = express();

app.set('trust proxy', 1);
const server = http.createServer(app);


app.use(helmet());
app.use(compression());

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:5173',
      'https://zenithggapi.vercel.app',
      'https://hacklotesite.vercel.app',
      'https://zenithgg.com.br',
      'https://zenith.enrelyugi.com.br',
      'https://zenithpaineladm.vercel.app',
      'https://apizenithadmin-byzenith.vercel.app'
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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'ngrok-skip-browser-warning', 'X-Admin-Key', 'X-API-Key', 'X-Admin-Name', 'X-Panel-Proxy-Secret']
};
app.use(cors(corsOptions));

// Middleware de log removido para evitar consumo excessivo de memória
// Apenas erros são logados via winston logger

app.use(express.json({ limit: '30mb' })); // Aumentado para suportar uploads de até 25 MB
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Middleware para servir imagens do banco de dados (com fallback para disco)
app.use('/uploads', imageServeMiddleware);

// Fallback: servir imagens do disco
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '7d',
  extensions: ['avif', 'png', 'jpg', 'jpeg'],
  setHeaders: (res, servedPath) => {
    try {
      const ext = path.extname(servedPath || '').toLowerCase();
      if (ext === '.avif') {
        res.setHeader('Content-Type', 'image/avif');
      } else if (ext === '.png') {
        res.setHeader('Content-Type', 'image/png');
      } else if (ext === '.jpg' || ext === '.jpeg') {
        res.setHeader('Content-Type', 'image/jpeg');
      }

      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');

      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      res.setHeader('Access-Control-Allow-Origin', '*');
    } catch (_) {}
  }
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);


app.get('/', (req, res) => {
  res.json({
    name: 'Zenith Chat API',
    version: '1.0.0',
    status: 'running',
    description: 'WebSocket-based real-time messaging API for Zenith marketplace',
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


const cacheRoutes = require('./src/routes/cache');
const checkBanned = require('./src/middleware/checkBanned');

// ✅ Rotas de autenticação (não verificar banimento aqui)
app.use('/api/auth', authRoutes);

// ✅ MIDDLEWARE GLOBAL: Verificar banimento em TODAS as rotas protegidas
// Aplicado após autenticação mas antes das rotas
app.use('/api', checkBanned);

app.use('/api/messages', messageRoutes);

app.use('/api/uploads', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/marketplace-webhook', marketplaceWebhookRoutes);
app.use('/api/boosting-chat', boostingChatRoutes);
app.use('/api/boosting-chat', temporaryChatRoutes);

app.use('/api/temporary-chat', temporaryChatRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/offline', offlineRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/cache', cacheRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/email', emailVerificationRoutes);
app.use('/api/qa', qaRoutes);
app.use('/api/ai/support', aiSupportRoutes);
app.use('/api/ratings', ratingsRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/purchases', purchasesRoutes);

// Support routes (tickets, detalhes)
app.use('/api/support', supportRoutes);

app.get('/api/routes', (req, res) => {
  try {
    const routes = [];
    app._router.stack.forEach((middleware) => {
      if (middleware.route) {
        routes.push({ base: '', path: middleware.route.path, methods: Object.keys(middleware.route.methods) });
      } else if (middleware.name === 'router' && middleware.handle?.stack) {
        const base = (middleware.regexp && middleware.regexp.toString()) || '';
        middleware.handle.stack.forEach((h) => {
          if (h.route) {
            routes.push({ base, path: h.route.path, methods: Object.keys(h.route.methods) });
          }
        });
      }
    });
    res.json({ success: true, routes });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to list routes', error: e.message });
  }
});

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


app.set('webSocketServer', wsServer);

// ✅ Inicializar BanService com WebSocket Server
const banService = require('./src/services/BanService');
banService.setWebSocketServer(wsServer);
app.set('banService', banService);


function gracefulShutdown(signal = 'SIGTERM') {
  const start = Date.now();
  logger.info(`${signal} signal received: initiating graceful shutdown`);

  // Stop background services (clear intervals/timeouts)
  try { temporaryChatCleanupService.stop(); } catch (e) { logger.warn('Error stopping TemporaryChatCleanupService', e); }
  try { purchaseAutoReleaseService.stop(); } catch (e) { logger.warn('Error stopping PurchaseAutoReleaseService', e); }

  // Close WebSocket server first so HTTP can close cleanly
  try { wsServer.close(); } catch (e) { logger.warn('Error closing WebSocket server', e); }

  // Graceful HTTP close with fallback force-exit
  const FORCE_EXIT_AFTER_MS = parseInt(process.env.FORCE_EXIT_AFTER_MS || '8000');
  const forceTimer = setTimeout(() => {
    logger.warn(`Force exiting process after ${FORCE_EXIT_AFTER_MS}ms grace period`);
    try { cache.close(); } catch (_) {}
    try { mongoose.connection?.close?.(); } catch (_) {}
    process.exit(0);
  }, FORCE_EXIT_AFTER_MS);
  forceTimer.unref?.();

  server.close(() => {
    logger.info(`HTTP server closed in ${Date.now() - start}ms`);
    try { cache.close(); } catch (_) {}
    try { mongoose.connection?.close?.(); } catch (_) {}
    clearTimeout(forceTimer);
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));


const PORT = process.env.PORT || 5000;
connectDB()
  .then(() => {
    server.listen(PORT, () => {
      logger.info(`🚀 Chat API Server running on port ${PORT}`);
      logger.info(`🔌 WebSocket server ready for connections`);
      logger.info(`📝 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🔗 Allowed origins: ${process.env.ALLOWED_ORIGINS}`);


      try {
        temporaryChatCleanupService.start();
      } catch (e) {
        logger.error('Failed to start TemporaryChatCleanupService:', e);
      }

      // Start purchase auto-release background job
      try {
        purchaseAutoReleaseService.start(app);
        logger.info('✅ Purchase auto-release service started');
      } catch (e) {
        logger.error('Failed to start purchase auto-release service:', e);
      }
    });
  })
  .catch((err) => {
    logger.error('❌ Failed to connect to MongoDB. Server not started.', err);
    process.exit(1);
  });

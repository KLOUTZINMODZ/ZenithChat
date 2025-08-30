// Teste final do servidor após correções
require('dotenv').config();

console.log('🧪 Teste final do servidor...');

try {
  console.log('1. ⏳ Carregando dependências básicas...');
  const express = require('express');
  const http = require('http');
  const cors = require('cors');
  const helmet = require('helmet');
  const compression = require('compression');
  const rateLimit = require('express-rate-limit');
  console.log('1. ✅ Dependências básicas OK');

  console.log('2. ⏳ Carregando WebSocket e database...');
  const WebSocketServer = require('./src/websocket/WebSocketServer');
  const connectDB = require('./src/config/database');
  const logger = require('./src/utils/logger');
  console.log('2. ✅ WebSocket e database OK');

  console.log('3. ⏳ Carregando routes...');
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
  console.log('3. ✅ Routes OK');

  console.log('4. ⏳ Carregando services...');
  const cache = require('./src/services/GlobalCache');
  const temporaryChatCleanupService = require('./src/services/temporaryChatCleanupService');
  console.log('4. ✅ Services OK');

  console.log('5. ⏳ Criando aplicação Express...');
  const app = express();
  app.set('trust proxy', 1);
  const server = http.createServer(app);
  console.log('5. ✅ Express app criado');

  console.log('6. ⏳ Configurando middlewares...');
  app.use(helmet());
  app.use(compression());
  console.log('6. ✅ Middlewares configurados');

  console.log('7. ⏳ Configurando CORS...');
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
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'ngrok-skip-browser-warning']
  };
  app.use(cors(corsOptions));
  console.log('7. ✅ CORS configurado');

  console.log('8. ⏳ Configurando body parsing...');
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  console.log('8. ✅ Body parsing configurado');

  console.log('9. ⏳ Configurando rate limiting...');
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: 'Too many requests from this IP, please try again later.'
  });
  app.use('/api/', limiter);
  console.log('9. ✅ Rate limiting configurado');

  console.log('10. ⏳ Registrando routes...');
  app.use('/api/auth', authRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/marketplace-webhook', marketplaceWebhookRoutes);
  app.use('/api/boosting-chat', boostingChatRoutes);
  app.use('/api/boosting-chat', temporaryChatRoutes);
  app.use('/api/proposals', proposalRoutes);
  app.use('/api/agreements', agreementRoutes);
  app.use('/api/route-cache', routeAwareCacheRoutes);
  console.log('10. ✅ Routes registradas');

  console.log('11. ⏳ Configurando rota básica...');
  app.get('/', (req, res) => {
    res.json({
      name: 'HackLote Chat API',
      version: '1.0.0',
      status: 'running',
      timestamp: new Date().toISOString()
    });
  });
  console.log('11. ✅ Rota básica configurada');

  console.log('✅ TODOS OS COMPONENTES CARREGADOS COM SUCESSO!');
  console.log('🚀 Servidor pronto para inicialização');
  
  process.exit(0);

} catch (error) {
  console.log('❌ ERRO:', error.message);
  console.log('📍 Stack:', error.stack);
  process.exit(1);
}

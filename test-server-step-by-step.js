// Teste passo a passo do servidor para identificar onde trava
require('dotenv').config();

console.log('🧪 Teste passo a passo do servidor...');

try {
  console.log('1. ✅ dotenv carregado');
  
  const express = require('express');
  console.log('2. ✅ express carregado');
  
  const http = require('http');
  console.log('3. ✅ http carregado');
  
  const cors = require('cors');
  console.log('4. ✅ cors carregado');
  
  const helmet = require('helmet');
  console.log('5. ✅ helmet carregado');
  
  const compression = require('compression');
  console.log('6. ✅ compression carregado');
  
  const rateLimit = require('express-rate-limit');
  console.log('7. ✅ rate-limit carregado');
  
  console.log('8. ⏳ Carregando WebSocketServer...');
  const WebSocketServer = require('./src/websocket/WebSocketServer');
  console.log('8. ✅ WebSocketServer carregado');
  
  console.log('9. ⏳ Carregando connectDB...');
  const connectDB = require('./src/config/database');
  console.log('9. ✅ connectDB carregado');
  
  console.log('10. ⏳ Carregando logger...');
  const logger = require('./src/utils/logger');
  console.log('10. ✅ logger carregado');
  
  console.log('11. ⏳ Carregando messageRoutes...');
  const messageRoutes = require('./src/routes/messageRoutes');
  console.log('11. ✅ messageRoutes carregado');
  
  console.log('12. ⏳ Carregando authRoutes...');
  const authRoutes = require('./src/routes/authRoutes');
  console.log('12. ✅ authRoutes carregado');
  
  console.log('13. ⏳ Carregando outros routes...');
  const notificationRoutes = require('./src/routes/notificationRoutes');
  const marketplaceWebhookRoutes = require('./src/routes/marketplaceWebhookRoutes');
  const boostingChatRoutes = require('./src/routes/boostingChatRoutes');
  const agreementRoutes = require('./src/routes/agreementRoutes');
  const compatibilityRoutes = require('./src/routes/compatibilityRoutes');
  const temporaryChatRoutes = require('./src/routes/temporaryChatRoutes');
  const proposalRoutes = require('./src/routes/proposalRoutes');
  const routeAwareCacheRoutes = require('./src/routes/routeAwareCacheRoutes');
  console.log('13. ✅ Todas as rotas carregadas');
  
  console.log('14. ⏳ Carregando cache...');
  const cache = require('./src/services/GlobalCache');
  console.log('14. ✅ cache carregado');
  
  console.log('15. ⏳ Carregando temporaryChatCleanupService...');
  const temporaryChatCleanupService = require('./src/services/temporaryChatCleanupService');
  console.log('15. ✅ temporaryChatCleanupService carregado');
  
  console.log('16. ⏳ Criando app Express...');
  const app = express();
  console.log('16. ✅ app Express criado');
  
  console.log('17. ⏳ Configurando trust proxy...');
  app.set('trust proxy', 1);
  console.log('17. ✅ trust proxy configurado');
  
  console.log('18. ⏳ Criando servidor HTTP...');
  const server = http.createServer(app);
  console.log('18. ✅ servidor HTTP criado');
  
  console.log('19. ⏳ Conectando ao MongoDB...');
  connectDB().then(() => {
    console.log('19. ✅ MongoDB conectado');
    
    console.log('20. ⏳ Configurando middlewares...');
    app.use(helmet());
    app.use(compression());
    console.log('20. ✅ middlewares básicos configurados');
    
    console.log('✅ Todos os componentes carregados com sucesso!');
    process.exit(0);
    
  }).catch(error => {
    console.log('19. ❌ Erro ao conectar MongoDB:', error.message);
    process.exit(1);
  });
  
} catch (error) {
  console.log('❌ Erro durante carregamento:', error.message);
  console.log('📍 Stack trace:', error.stack);
  process.exit(1);
}

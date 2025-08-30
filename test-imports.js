// Teste direto dos imports do servidor
console.log('🧪 Testando imports do servidor...');

try {
  console.log('1. Testando dotenv...');
  require('dotenv').config();
  console.log('✅ dotenv OK');
} catch (error) {
  console.log('❌ dotenv:', error.message);
}

try {
  console.log('2. Testando express...');
  const express = require('express');
  console.log('✅ express OK');
} catch (error) {
  console.log('❌ express:', error.message);
}

try {
  console.log('3. Testando auth middleware...');
  const auth = require('./src/middleware/auth');
  console.log('✅ auth middleware OK');
} catch (error) {
  console.log('❌ auth middleware:', error.message);
}

try {
  console.log('4. Testando cache middleware...');
  const { cacheMiddleware } = require('./src/middleware/cacheMiddleware');
  console.log('✅ cache middleware OK');
} catch (error) {
  console.log('❌ cache middleware:', error.message);
}

try {
  console.log('5. Testando route tracking middleware...');
  const { routeTrackingMiddleware } = require('./src/middleware/routeTrackingMiddleware');
  console.log('✅ route tracking middleware OK');
} catch (error) {
  console.log('❌ route tracking middleware:', error.message);
}

try {
  console.log('6. Testando models...');
  const Conversation = require('./src/models/Conversation');
  const Message = require('./src/models/Message');
  console.log('✅ models OK');
} catch (error) {
  console.log('❌ models:', error.message);
}

try {
  console.log('7. Testando services...');
  const cache = require('./src/services/GlobalCache');
  const routeCache = require('./src/services/RouteAwareConversationCache');
  console.log('✅ services OK');
} catch (error) {
  console.log('❌ services:', error.message);
}

try {
  console.log('8. Testando message routes...');
  const messageRoutes = require('./src/routes/messageRoutes');
  console.log('✅ message routes OK');
} catch (error) {
  console.log('❌ message routes:', error.message);
}

try {
  console.log('9. Testando route-aware cache routes...');
  const routeAwareCacheRoutes = require('./src/routes/routeAwareCacheRoutes');
  console.log('✅ route-aware cache routes OK');
} catch (error) {
  console.log('❌ route-aware cache routes:', error.message);
}

console.log('\n🏁 Teste de imports concluído');

/**
 * Script para adicionar índices de performance adicionais ao MongoDB
 * Executa apenas UMA vez após deploy das otimizações
 */

require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../src/utils/logger');

async function addPerformanceIndexes() {
  try {
    logger.info('Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 30000
    });
    
    logger.info('✅ Conectado ao MongoDB');
    
    const db = mongoose.connection.db;
    
    // Índices para User (online status e pesquisas)
    logger.info('Adicionando índices em User...');
    await db.collection('users').createIndex(
      { lastSeenAt: -1 },
      { background: true, name: 'idx_lastSeenAt' }
    );
    await db.collection('users').createIndex(
      { isOnline: 1, lastSeenAt: -1 },
      { background: true, name: 'idx_isOnline_lastSeenAt', sparse: true }
    );
    logger.info('✅ Índices User criados');
    
    // Índices para Conversation (chats temporários)
    logger.info('Adicionando índices em Conversation...');
    await db.collection('conversations').createIndex(
      { isTemporary: 1, expiresAt: 1 },
      { background: true, name: 'idx_temporary_expiry', sparse: true }
    );
    await db.collection('conversations').createIndex(
      { isTemporary: 1, status: 1, expiresAt: 1 },
      { background: true, name: 'idx_temporary_status_expiry', sparse: true }
    );
    logger.info('✅ Índices Conversation criados');
    
    // Índices para Message (performance em queries de mensagens)
    logger.info('Adicionando índices em Message...');
    await db.collection('messages').createIndex(
      { conversation: 1, type: 1, createdAt: -1 },
      { background: true, name: 'idx_conversation_type_created' }
    );
    logger.info('✅ Índices Message criados');
    
    // Índices para AcceptedProposal
    logger.info('Adicionando índices em AcceptedProposal...');
    await db.collection('acceptedproposals').createIndex(
      { conversationId: 1, status: 1 },
      { background: true, name: 'idx_conversation_status' }
    );
    await db.collection('acceptedproposals').createIndex(
      { 'client.userid': 1, status: 1 },
      { background: true, name: 'idx_client_status', sparse: true }
    );
    await db.collection('acceptedproposals').createIndex(
      { 'booster.userid': 1, status: 1 },
      { background: true, name: 'idx_booster_status', sparse: true }
    );
    logger.info('✅ Índices AcceptedProposal criados');
    
    // Índices para Agreement
    logger.info('Adicionando índices em Agreement...');
    await db.collection('agreements').createIndex(
      { conversationId: 1, status: 1 },
      { background: true, name: 'idx_conversation_status' }
    );
    await db.collection('agreements').createIndex(
      { 'parties.client.userid': 1, status: 1 },
      { background: true, name: 'idx_client_status', sparse: true }
    );
    await db.collection('agreements').createIndex(
      { 'parties.booster.userid': 1, status: 1 },
      { background: true, name: 'idx_booster_status', sparse: true }
    );
    logger.info('✅ Índices Agreement criados');
    
    logger.info('🎉 TODOS OS ÍNDICES DE PERFORMANCE FORAM CRIADOS COM SUCESSO!');
    logger.info('⚡ Queries agora serão significativamente mais rápidas');
    
    // Listar todos os índices criados
    logger.info('\n📊 Resumo de índices por coleção:');
    const collections = ['users', 'conversations', 'messages', 'acceptedproposals', 'agreements'];
    
    for (const collName of collections) {
      try {
        const indexes = await db.collection(collName).indexes();
        logger.info(`\n${collName}: ${indexes.length} índices`);
        indexes.forEach(idx => {
          logger.info(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
        });
      } catch (err) {
        logger.warn(`Coleção ${collName} não encontrada`);
      }
    }
    
  } catch (error) {
    logger.error('❌ Erro ao criar índices:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    logger.info('\n✅ Conexão fechada. Script finalizado.');
    process.exit(0);
  }
}

// Executar
addPerformanceIndexes();

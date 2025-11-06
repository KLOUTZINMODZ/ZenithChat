/**
 * INDEX MANAGER
 * 
 * Serviço automático que garante que todos os índices do MongoDB
 * estão corretos ao iniciar a aplicação.
 * 
 * PREVINE ERRO E11000 para pixKeyFingerprint e phoneNormalized
 * 
 * Executado automaticamente a cada startup do servidor.
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Verifica e corrige índices automaticamente
 */
async function ensureCorrectIndexes() {
  try {
    logger.info('🔍 [INDEX MANAGER] Verificando índices do MongoDB...');
    
    const db = mongoose.connection.db;
    const collection = db.collection('users');
    
    // Obter índices atuais
    const indexes = await collection.indexes();
    
    // Array para rastrear ações
    const actions = [];
    
    // ============================================
    // 1. VERIFICAR E CORRIGIR pixKeyFingerprint
    // ============================================
    const pixKeyIndex = indexes.find(idx => idx.key && idx.key.pixKeyFingerprint);
    
    if (pixKeyIndex) {
      if (!pixKeyIndex.sparse) {
        logger.warn('⚠️  [INDEX MANAGER] pixKeyFingerprint sem sparse! Corrigindo...');
        
        // Remover índice antigo
        await collection.dropIndex(pixKeyIndex.name);
        actions.push(`Removido índice antigo: ${pixKeyIndex.name}`);
        
        // Criar novo com sparse
        await collection.createIndex(
          { pixKeyFingerprint: 1 },
          { unique: true, sparse: true, name: 'pixKeyFingerprint_1' }
        );
        actions.push('Criado pixKeyFingerprint_1 com sparse: true');
        
        logger.info('✅ [INDEX MANAGER] pixKeyFingerprint corrigido!');
      } else {
        logger.info('✅ [INDEX MANAGER] pixKeyFingerprint já está correto (sparse: true)');
      }
    } else {
      // Índice não existe, criar
      logger.warn('⚠️  [INDEX MANAGER] pixKeyFingerprint não encontrado! Criando...');
      
      await collection.createIndex(
        { pixKeyFingerprint: 1 },
        { unique: true, sparse: true, name: 'pixKeyFingerprint_1' }
      );
      actions.push('Criado pixKeyFingerprint_1 com sparse: true');
      
      logger.info('✅ [INDEX MANAGER] pixKeyFingerprint criado!');
    }
    
    // ============================================
    // 2. VERIFICAR E CORRIGIR phoneNormalized
    // ============================================
    const phoneIndex = indexes.find(idx => idx.key && idx.key.phoneNormalized);
    
    if (phoneIndex) {
      if (!phoneIndex.sparse) {
        logger.warn('⚠️  [INDEX MANAGER] phoneNormalized sem sparse! Corrigindo...');
        
        // Remover índice antigo
        await collection.dropIndex(phoneIndex.name);
        actions.push(`Removido índice antigo: ${phoneIndex.name}`);
        
        // Criar novo com sparse
        await collection.createIndex(
          { phoneNormalized: 1 },
          { unique: true, sparse: true, name: 'phoneNormalized_1' }
        );
        actions.push('Criado phoneNormalized_1 com sparse: true');
        
        logger.info('✅ [INDEX MANAGER] phoneNormalized corrigido!');
      } else {
        logger.info('✅ [INDEX MANAGER] phoneNormalized já está correto (sparse: true)');
      }
    } else {
      // Índice não existe, criar
      logger.warn('⚠️  [INDEX MANAGER] phoneNormalized não encontrado! Criando...');
      
      await collection.createIndex(
        { phoneNormalized: 1 },
        { unique: true, sparse: true, name: 'phoneNormalized_1' }
      );
      actions.push('Criado phoneNormalized_1 com sparse: true');
      
      logger.info('✅ [INDEX MANAGER] phoneNormalized criado!');
    }
    
    // ============================================
    // 3. RESULTADO FINAL
    // ============================================
    if (actions.length > 0) {
      logger.info('🔨 [INDEX MANAGER] Ações executadas:');
      actions.forEach(action => logger.info(`   - ${action}`));
    } else {
      logger.info('✅ [INDEX MANAGER] Todos os índices já estão corretos');
    }
    
    // Verificar resultado
    const finalIndexes = await collection.indexes();
    const finalPixKey = finalIndexes.find(idx => idx.key && idx.key.pixKeyFingerprint);
    const finalPhone = finalIndexes.find(idx => idx.key && idx.key.phoneNormalized);
    
    logger.info('📊 [INDEX MANAGER] Estado final dos índices:');
    if (finalPixKey) {
      logger.info(`   ✅ pixKeyFingerprint: unique=${finalPixKey.unique}, sparse=${finalPixKey.sparse}`);
    }
    if (finalPhone) {
      logger.info(`   ✅ phoneNormalized: unique=${finalPhone.unique}, sparse=${finalPhone.sparse}`);
    }
    
    logger.info('✅ [INDEX MANAGER] Verificação concluída com sucesso!');
    
    return {
      success: true,
      actions,
      indexes: {
        pixKeyFingerprint: finalPixKey ? { unique: finalPixKey.unique, sparse: finalPixKey.sparse } : null,
        phoneNormalized: finalPhone ? { unique: finalPhone.unique, sparse: finalPhone.sparse } : null
      }
    };
    
  } catch (error) {
    logger.error('❌ [INDEX MANAGER] Erro ao verificar/corrigir índices:', error);
    throw error;
  }
}

/**
 * Verifica se índices estão corretos (para health check)
 */
async function checkIndexHealth() {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('users');
    const indexes = await collection.indexes();
    
    const pixKeyIndex = indexes.find(idx => idx.key && idx.key.pixKeyFingerprint);
    const phoneIndex = indexes.find(idx => idx.key && idx.key.phoneNormalized);
    
    const health = {
      pixKeyFingerprint: {
        exists: !!pixKeyIndex,
        unique: pixKeyIndex?.unique || false,
        sparse: pixKeyIndex?.sparse || false,
        healthy: pixKeyIndex?.unique && pixKeyIndex?.sparse
      },
      phoneNormalized: {
        exists: !!phoneIndex,
        unique: phoneIndex?.unique || false,
        sparse: phoneIndex?.sparse || false,
        healthy: phoneIndex?.unique && phoneIndex?.sparse
      }
    };
    
    health.allHealthy = health.pixKeyFingerprint.healthy && health.phoneNormalized.healthy;
    
    return health;
  } catch (error) {
    logger.error('❌ [INDEX MANAGER] Erro ao verificar saúde dos índices:', error);
    return { allHealthy: false, error: error.message };
  }
}

module.exports = {
  ensureCorrectIndexes,
  checkIndexHealth
};

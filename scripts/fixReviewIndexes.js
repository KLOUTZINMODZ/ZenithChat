require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Script para corrigir os índices da coleção reviews
 * Remove índices antigos problemáticos e cria novos índices sparse
 */

async function fixReviewIndexes() {
  try {
    console.log('🔧 Corrigindo índices da coleção reviews...\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    const db = mongoose.connection.db;
    const reviewsCollection = db.collection('reviews');

    // Listar índices atuais
    console.log('📋 Índices atuais:');
    const currentIndexes = await reviewsCollection.indexes();
    currentIndexes.forEach(idx => {
      console.log(`  - ${idx.name}:`, idx.key);
    });
    console.log();

    // Remover índice problemático purchaseId_1 se existir
    try {
      await reviewsCollection.dropIndex('purchaseId_1');
      console.log('🗑️  Removido índice antigo: purchaseId_1');
    } catch (err) {
      if (err.code === 27) {
        console.log('ℹ️  Índice purchaseId_1 não existe (ok)');
      } else {
        console.warn('⚠️  Erro ao remover purchaseId_1:', err.message);
      }
    }

    // Remover índice agreementId_1 se existir
    try {
      await reviewsCollection.dropIndex('agreementId_1');
      console.log('🗑️  Removido índice antigo: agreementId_1');
    } catch (err) {
      if (err.code === 27) {
        console.log('ℹ️  Índice agreementId_1 não existe (ok)');
      } else {
        console.warn('⚠️  Erro ao remover agreementId_1:', err.message);
      }
    }

    console.log();

    // Criar novos índices sparse
    console.log('🔨 Criando novos índices sparse...');
    
    try {
      await reviewsCollection.createIndex(
        { purchaseId: 1 }, 
        { sparse: true, unique: true, name: 'purchaseId_1_sparse' }
      );
      console.log('✅ Criado índice: purchaseId_1_sparse (sparse + unique)');
    } catch (err) {
      console.warn('⚠️  Erro ao criar purchaseId_1_sparse:', err.message);
    }

    try {
      await reviewsCollection.createIndex(
        { agreementId: 1 }, 
        { sparse: true, unique: true, name: 'agreementId_1_sparse' }
      );
      console.log('✅ Criado índice: agreementId_1_sparse (sparse + unique)');
    } catch (err) {
      console.warn('⚠️  Erro ao criar agreementId_1_sparse:', err.message);
    }

    console.log();

    // Listar índices finais
    console.log('📋 Índices após correção:');
    const finalIndexes = await reviewsCollection.indexes();
    finalIndexes.forEach(idx => {
      console.log(`  - ${idx.name}:`, idx.key, idx.sparse ? '(sparse)' : '', idx.unique ? '(unique)' : '');
    });

    console.log('\n✅ Correção de índices concluída com sucesso!');

  } catch (error) {
    console.error('❌ Erro na correção de índices:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Conexão com MongoDB fechada');
    process.exit(0);
  }
}

fixReviewIndexes();

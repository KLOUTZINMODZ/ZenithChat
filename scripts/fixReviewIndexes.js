require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Script para corrigir os índices da coleção reviews
 * Remove índices antigos problemáticos e cria novos índices sparse
 */

async function fixReviewIndexes() {
  try {
    

    await mongoose.connect(process.env.MONGODB_URI);
    

    const db = mongoose.connection.db;
    const reviewsCollection = db.collection('reviews');

    // Listar índices atuais
    
    const currentIndexes = await reviewsCollection.indexes();
    currentIndexes.forEach(idx => {
      
    });
    

    // Remover índice problemático purchaseId_1 se existir
    try {
      await reviewsCollection.dropIndex('purchaseId_1');
      
    } catch (err) {
      if (err.code === 27) {
        ');
      } else {
        
      }
    }

    // Remover índice agreementId_1 se existir
    try {
      await reviewsCollection.dropIndex('agreementId_1');
      
    } catch (err) {
      if (err.code === 27) {
        ');
      } else {
        
      }
    }

    

    // Criar novos índices sparse
    
    
    try {
      await reviewsCollection.createIndex(
        { purchaseId: 1 }, 
        { sparse: true, unique: true, name: 'purchaseId_1_sparse' }
      );
      ');
    } catch (err) {
      
    }

    try {
      await reviewsCollection.createIndex(
        { agreementId: 1 }, 
        { sparse: true, unique: true, name: 'agreementId_1_sparse' }
      );
      ');
    } catch (err) {
      
    }

    

    // Listar índices finais
    
    const finalIndexes = await reviewsCollection.indexes();
    finalIndexes.forEach(idx => {
      ' : '', idx.unique ? '(unique)' : '');
    });

    

  } catch (error) {
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

fixReviewIndexes();

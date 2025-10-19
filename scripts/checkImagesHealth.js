require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script para verificar a saúde das imagens no MongoDB
 * Identifica problemas como buffers vazios, corrompidos ou ausentes
 */

async function checkImagesHealth() {
  try {
    

    // Conectar ao MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    

    const images = await UploadedImage.find({}).lean();
    
    

    let healthy = 0;
    let issues = 0;
    const problemImages = [];

    for (const img of images) {
      const problems = [];
      
      // Verificar strings base64
      if (!img.fullImage || typeof img.fullImage !== 'string' || img.fullImage.length === 0) {
        problems.push('fullImage inválido ou vazio');
      }
      if (!img.thumbImage || typeof img.thumbImage !== 'string' || img.thumbImage.length === 0) {
        problems.push('thumbImage inválido ou vazio');
      }
      if (!img.fullImageJpeg || typeof img.fullImageJpeg !== 'string' || img.fullImageJpeg.length === 0) {
        problems.push('fullImageJpeg inválido ou vazio');
      }
      if (!img.thumbImageJpeg || typeof img.thumbImageJpeg !== 'string' || img.thumbImageJpeg.length === 0) {
        problems.push('thumbImageJpeg inválido ou vazio');
      }
      
      // Verificar metadados essenciais
      if (!img.imageId) {
        problems.push('imageId ausente');
      }
      if (!img.imageType || !['conversation', 'marketplace'].includes(img.imageType)) {
        problems.push('imageType inválido');
      }
      
      if (problems.length > 0) {
        issues++;
        problemImages.push({
          imageId: img.imageId,
          type: img.imageType,
          conversationId: img.conversationId,
          uploadedAt: img.uploadedAt,
          problems
        });
        }`);
      } else {
        healthy++;
      }
    }

    
    
    
    
    if (problemImages.length > 0) {
      
      problemImages.forEach(img => {
        : ${img.problems.join(', ')}`);
      });
    }

    // Estatísticas de tamanho
    
    const sizes = images
      .filter(img => img.fullImage && Buffer.isBuffer(img.fullImage))
      .map(img => img.fullImage.length);
    
    if (sizes.length > 0) {
      const totalSize = sizes.reduce((a, b) => a + b, 0);
      const avgSize = totalSize / sizes.length;
      const maxSize = Math.max(...sizes);
      const minSize = Math.min(...sizes);
      
      .toFixed(2)} MB`);
      .toFixed(2)} KB`);
      .toFixed(2)} KB`);
      .toFixed(2)} KB`);
    }

    // Distribuição por tipo
    const byType = images.reduce((acc, img) => {
      acc[img.imageType] = (acc[img.imageType] || 0) + 1;
      return acc;
    }, {});
    
    
    Object.entries(byType).forEach(([type, count]) => {
      
    });

    
    
  } catch (error) {
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

checkImagesHealth();

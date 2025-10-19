require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script para verificar a saúde das imagens no MongoDB
 * Identifica problemas como buffers vazios, corrompidos ou ausentes
 */

async function checkImagesHealth() {
  try {
    console.log('🔍 Verificando saúde das imagens no MongoDB...\n');

    // Conectar ao MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    const images = await UploadedImage.find({}).lean();
    
    console.log(`📦 Total de imagens: ${images.length}\n`);

    let healthy = 0;
    let issues = 0;
    const problemImages = [];

    for (const img of images) {
      const problems = [];
      
      // Verificar buffers
      if (!img.fullImage || !Buffer.isBuffer(img.fullImage) || img.fullImage.length === 0) {
        problems.push('fullImage inválido ou vazio');
      }
      if (!img.thumbImage || !Buffer.isBuffer(img.thumbImage) || img.thumbImage.length === 0) {
        problems.push('thumbImage inválido ou vazio');
      }
      if (!img.fullImageJpeg || !Buffer.isBuffer(img.fullImageJpeg) || img.fullImageJpeg.length === 0) {
        problems.push('fullImageJpeg inválido ou vazio');
      }
      if (!img.thumbImageJpeg || !Buffer.isBuffer(img.thumbImageJpeg) || img.thumbImageJpeg.length === 0) {
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
        console.log(`❌ ${img.imageId}: ${problems.join(', ')}`);
      } else {
        healthy++;
      }
    }

    console.log('\n📊 Resumo:');
    console.log(`✅ Saudáveis: ${healthy}`);
    console.log(`❌ Com problemas: ${issues}`);
    
    if (problemImages.length > 0) {
      console.log('\n⚠️  Imagens com problemas:');
      problemImages.forEach(img => {
        console.log(`  - ${img.imageId} (${img.type}): ${img.problems.join(', ')}`);
      });
    }

    // Estatísticas de tamanho
    console.log('\n📈 Estatísticas de tamanho:');
    const sizes = images
      .filter(img => img.fullImage && Buffer.isBuffer(img.fullImage))
      .map(img => img.fullImage.length);
    
    if (sizes.length > 0) {
      const totalSize = sizes.reduce((a, b) => a + b, 0);
      const avgSize = totalSize / sizes.length;
      const maxSize = Math.max(...sizes);
      const minSize = Math.min(...sizes);
      
      console.log(`  Total: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Média: ${(avgSize / 1024).toFixed(2)} KB`);
      console.log(`  Máximo: ${(maxSize / 1024).toFixed(2)} KB`);
      console.log(`  Mínimo: ${(minSize / 1024).toFixed(2)} KB`);
    }

    // Distribuição por tipo
    const byType = images.reduce((acc, img) => {
      acc[img.imageType] = (acc[img.imageType] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\n📊 Distribuição por tipo:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    console.log('\n');
    
  } catch (error) {
    console.error('❌ Erro na verificação:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Conexão com MongoDB fechada');
    process.exit(0);
  }
}

checkImagesHealth();

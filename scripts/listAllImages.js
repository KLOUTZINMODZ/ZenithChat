require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script para listar todas as imagens e encontrar uma específica
 */

async function listAllImages() {
  console.log('📋 LISTANDO TODAS AS IMAGENS DO BANCO\n');
  console.log('='.repeat(80));
  
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    // Estatísticas gerais
    const total = await UploadedImage.countDocuments();
    const marketplace = await UploadedImage.countDocuments({ imageType: 'marketplace' });
    const conversation = await UploadedImage.countDocuments({ imageType: 'conversation' });
    
    console.log('📊 ESTATÍSTICAS GERAIS');
    console.log('-'.repeat(80));
    console.log(`   Total de imagens: ${total}`);
    console.log(`   Marketplace: ${marketplace}`);
    console.log(`   Conversas: ${conversation}`);

    // Listar imagens de marketplace (mais recentes primeiro)
    console.log('\n📦 IMAGENS DE MARKETPLACE (10 mais recentes)');
    console.log('-'.repeat(80));
    
    const marketplaceImages = await UploadedImage.find({ imageType: 'marketplace' })
      .sort({ uploadedAt: -1 })
      .limit(10)
      .select('imageId urls.full uploadedAt metadata.originalName')
      .lean();
    
    if (marketplaceImages.length === 0) {
      console.log('   ❌ Nenhuma imagem de marketplace encontrada');
    } else {
      marketplaceImages.forEach((img, index) => {
        console.log(`\n   ${index + 1}. ImageId: ${img.imageId}`);
        console.log(`      URL: ${img.urls?.full || 'N/A'}`);
        console.log(`      Nome: ${img.metadata?.originalName || 'N/A'}`);
        console.log(`      Data: ${new Date(img.uploadedAt).toLocaleString('pt-BR')}`);
      });
    }

    // Buscar imagem específica do erro
    const targetImageId = '1760889095249_ve5m4a7ykn';
    console.log(`\n🔍 BUSCANDO IMAGEM ESPECÍFICA: ${targetImageId}`);
    console.log('-'.repeat(80));
    
    const specificImage = await UploadedImage.findOne({ imageId: targetImageId }).lean();
    
    if (!specificImage) {
      console.log(`❌ Imagem ${targetImageId} NÃO ENCONTRADA no banco!`);
      
      // Buscar imagens com ID parcial similar
      const partialId = targetImageId.substring(0, 10);
      const similar = await UploadedImage.find({
        imageId: new RegExp(partialId, 'i')
      }).select('imageId uploadedAt').lean();
      
      if (similar.length > 0) {
        console.log(`\n   📋 Imagens com ID similar (${partialId}*):`);
        similar.forEach(img => {
          console.log(`      - ${img.imageId} (${new Date(img.uploadedAt).toLocaleString('pt-BR')})`);
        });
      } else {
        console.log(`   Nenhuma imagem similar encontrada`);
      }
      
    } else {
      console.log(`✅ Imagem ${targetImageId} ENCONTRADA!`);
      console.log(`\n   Detalhes completos:`);
      console.log(`   _id: ${specificImage._id}`);
      console.log(`   ImageId: ${specificImage.imageId}`);
      console.log(`   Tipo: ${specificImage.imageType}`);
      console.log(`   ConversationId: ${specificImage.conversationId || 'N/A'}`);
      console.log(`   Upload: ${new Date(specificImage.uploadedAt).toLocaleString('pt-BR')}`);
      console.log(`   Permanente: ${specificImage.permanent}`);
      
      if (specificImage.urls) {
        console.log(`\n   URLs:`);
        console.log(`   - Full AVIF: ${specificImage.urls.full}`);
        console.log(`   - Thumb AVIF: ${specificImage.urls.thumb}`);
        console.log(`   - Full JPEG: ${specificImage.urls.fullJpeg}`);
        console.log(`   - Thumb JPEG: ${specificImage.urls.thumbJpeg}`);
      }
      
      if (specificImage.metadata) {
        console.log(`\n   Metadados:`);
        console.log(`   - Nome: ${specificImage.metadata.originalName}`);
        console.log(`   - Tamanho: ${(specificImage.metadata.originalSize / 1024).toFixed(2)} KB`);
        console.log(`   - MIME: ${specificImage.metadata.originalMimeType}`);
        console.log(`   - Dimensões: ${specificImage.metadata.width} x ${specificImage.metadata.height}`);
      }
      
      console.log(`\n   Base64 Strings:`);
      const base64Checks = {
        fullImage: specificImage.fullImage,
        thumbImage: specificImage.thumbImage,
        fullImageJpeg: specificImage.fullImageJpeg,
        thumbImageJpeg: specificImage.thumbImageJpeg
      };
      
      for (const [name, base64] of Object.entries(base64Checks)) {
        const isValid = base64 && typeof base64 === 'string' && base64.length > 0;
        console.log(`   ${isValid ? '✅' : '❌'} ${name}: ${isValid ? base64.length + ' caracteres' : 'VAZIO/INVÁLIDO'}`);
      }
    }

    // Buscar imagens corrompidas
    console.log('\n⚠️  VERIFICANDO IMAGENS CORROMPIDAS');
    console.log('-'.repeat(80));
    
    const allImages = await UploadedImage.find({}).select('imageId fullImage').lean();
    const corrupted = allImages.filter(img => 
      !img.fullImage || typeof img.fullImage !== 'string' || img.fullImage.length === 0
    );
    
    if (corrupted.length > 0) {
      console.log(`❌ ${corrupted.length} imagens corrompidas encontradas:`);
      corrupted.slice(0, 10).forEach(img => {
        console.log(`   - ${img.imageId}`);
      });
      if (corrupted.length > 10) {
        console.log(`   ... e mais ${corrupted.length - 10}`);
      }
      console.log(`\n   💡 Execute: npm run images:clean para remover`);
    } else {
      console.log(`✅ Nenhuma imagem corrompida encontrada`);
    }

  } catch (error) {
    console.error('\n❌ ERRO:', error);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Conexão fechada\n');
    process.exit(0);
  }
}

listAllImages();

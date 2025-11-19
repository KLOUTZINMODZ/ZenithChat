require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script para limpar TODAS as imagens corrompidas (com base64 inválido)
 */

async function cleanAllCorrupted() {
  try {
    console.log('🧹 LIMPEZA TOTAL DE IMAGENS CORROMPIDAS\n');
    console.log('='.repeat(60));
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    const allImages = await UploadedImage.find({}).lean();
    console.log(`📦 Total de imagens: ${allImages.length}\n`);

    console.log('🔍 Verificando quais estão corrompidas...\n');
    
    let deleted = 0;
    const toDelete = [];
    
    for (const img of allImages) {
      // Verificar se as strings base64 são válidas
      const fullImageValid = img.fullImage && typeof img.fullImage === 'string' && img.fullImage.length > 0;
      const thumbImageValid = img.thumbImage && typeof img.thumbImage === 'string' && img.thumbImage.length > 0;
      const fullJpegValid = img.fullImageJpeg && typeof img.fullImageJpeg === 'string' && img.fullImageJpeg.length > 0;
      const thumbJpegValid = img.thumbImageJpeg && typeof img.thumbImageJpeg === 'string' && img.thumbImageJpeg.length > 0;
      
      const isCorrupted = !fullImageValid || !thumbImageValid || !fullJpegValid || !thumbJpegValid;
      
      if (isCorrupted) {
        toDelete.push(img.imageId);
      }
    }

    console.log(`❌ Encontradas ${toDelete.length} imagens corrompidas\n`);
    
    if (toDelete.length === 0) {
      console.log('✅ Nenhuma imagem corrompida! Banco está limpo.\n');
      return;
    }

    console.log('⚠️  Esta operação vai DELETAR todas as imagens corrompidas!');
    console.log(`   Total a remover: ${toDelete.length}`);
    console.log('\n🗑️  Removendo...\n');

    for (const imageId of toDelete) {
      await UploadedImage.deleteOne({ imageId });
      console.log(`   ✅ Removida: ${imageId}`);
      deleted++;
    }

    const remaining = await UploadedImage.countDocuments();
    
    console.log('\n📊 RESUMO:');
    console.log('='.repeat(60));
    console.log(`🗑️  Removidas: ${deleted}`);
    console.log(`✅ Restantes: ${remaining}`);
    console.log(`📦 Total original: ${allImages.length}`);
    
    console.log('\n✅ Limpeza concluída!');
    console.log('💡 Agora você pode fazer novos uploads com o sistema base64\n');

  } catch (error) {
    console.error('\n❌ ERRO:', error);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Conexão fechada\n');
    process.exit(0);
  }
}

cleanAllCorrupted();

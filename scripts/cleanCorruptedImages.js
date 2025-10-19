require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script para remover imagens corrompidas (buffers vazios) do MongoDB
 */

async function cleanCorruptedImages() {
  try {
    console.log('🧹 Limpando imagens corrompidas do MongoDB...\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    const images = await UploadedImage.find({}).lean();
    
    console.log(`📦 Total de imagens encontradas: ${images.length}\n`);

    let deleted = 0;
    const corruptedIds = [];

    for (const img of images) {
      // Verificar se buffers existem e não estão vazios
      const fullImageValid = img.fullImage && Buffer.isBuffer(img.fullImage) && img.fullImage.length > 0;
      const thumbImageValid = img.thumbImage && Buffer.isBuffer(img.thumbImage) && img.thumbImage.length > 0;
      const fullJpegValid = img.fullImageJpeg && Buffer.isBuffer(img.fullImageJpeg) && img.fullImageJpeg.length > 0;
      const thumbJpegValid = img.thumbImageJpeg && Buffer.isBuffer(img.thumbImageJpeg) && img.thumbImageJpeg.length > 0;

      const isCorrupted = !fullImageValid || !thumbImageValid || !fullJpegValid || !thumbJpegValid;

      if (isCorrupted) {
        corruptedIds.push(img.imageId);
        await UploadedImage.deleteOne({ _id: img._id });
        console.log(`🗑️  Removida: ${img.imageId}`);
        deleted++;
      }
    }

    console.log('\n📊 Resumo da limpeza:');
    console.log(`🗑️  Removidas: ${deleted}`);
    console.log(`✅ Mantidas: ${images.length - deleted}`);
    
    const remaining = await UploadedImage.countDocuments();
    console.log(`📦 Total no banco após limpeza: ${remaining}\n`);

    if (deleted > 0) {
      console.log('⚠️  IMPORTANTE: As imagens removidas eram corrompidas (sem buffers).');
      console.log('   Novas imagens salvas a partir de agora terão buffers válidos.\n');
    }

  } catch (error) {
    console.error('❌ Erro na limpeza:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Conexão com MongoDB fechada');
    process.exit(0);
  }
}

cleanCorruptedImages();

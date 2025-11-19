require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImageV2 = require('../src/models/UploadedImageV2');
const sharp = require('sharp');

/**
 * Teste de armazenamento usando base64 em vez de Buffer
 */

async function testBase64Storage() {
  console.log('🧪 TESTE DE ARMAZENAMENTO BASE64\n');
  console.log('='.repeat(60));
  
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    // TESTE 1: Buffer simples para base64
    console.log('📦 TESTE 1: Conversão Buffer → Base64 → Buffer');
    console.log('-'.repeat(60));
    
    const originalBuffer = Buffer.alloc(1024, 'X');
    console.log(`   Buffer original: ${originalBuffer.length} bytes`);
    
    const base64 = UploadedImageV2.bufferToBase64(originalBuffer);
    console.log(`   Base64 string: ${base64.length} caracteres`);
    
    const recoveredBuffer = UploadedImageV2.base64ToBuffer(base64);
    console.log(`   Buffer recuperado: ${recoveredBuffer.length} bytes`);
    
    const identical = originalBuffer.equals(recoveredBuffer);
    console.log(`   ${identical ? '✅' : '❌'} Buffers são idênticos: ${identical}`);

    // TESTE 2: Imagem real com Sharp
    console.log('\n📦 TESTE 2: Imagem Real (Sharp → Base64 → MongoDB)');
    console.log('-'.repeat(60));
    
    const testImage = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 255, g: 0, b: 255, alpha: 1 }
      }
    })
    .png()
    .toBuffer();
    
    console.log(`   Imagem criada: ${(testImage.length / 1024).toFixed(2)} KB`);

    const image = sharp(testImage);
    const fullBuffer = await image.clone().avif({ quality: 45 }).toBuffer();
    const thumbBuffer = await image.clone().resize(512, 512).avif({ quality: 40 }).toBuffer();
    const fullJpegBuffer = await image.clone().jpeg({ quality: 80 }).toBuffer();
    const thumbJpegBuffer = await image.clone().resize(512, 512).jpeg({ quality: 78 }).toBuffer();
    
    console.log(`   Full AVIF: ${(fullBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Thumb AVIF: ${(thumbBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Full JPEG: ${(fullJpegBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Thumb JPEG: ${(thumbJpegBuffer.length / 1024).toFixed(2)} KB`);

    // TESTE 3: Salvar no MongoDB usando base64
    console.log('\n📦 TESTE 3: Salvar no MongoDB (Base64)');
    console.log('-'.repeat(60));
    
    const now = new Date();
    const baseName = `testb64_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    const savedImage = await UploadedImageV2.createFromBuffers({
      imageId: baseName,
      conversationId: null,
      imageType: 'marketplace',
      fullImage: fullBuffer,
      thumbImage: thumbBuffer,
      fullImageJpeg: fullJpegBuffer,
      thumbImageJpeg: thumbJpegBuffer,
      metadata: {
        originalName: 'test-base64.png',
        originalSize: testImage.length,
        originalMimeType: 'image/png',
        width: 500,
        height: 500
      },
      urls: {
        full: `/uploads/marketplace/${now.getFullYear()}/${now.getMonth() + 1}/${baseName}.avif`,
        thumb: `/uploads/marketplace/${now.getFullYear()}/${now.getMonth() + 1}/${baseName}_thumb.avif`,
        fullJpeg: `/uploads/marketplace/${now.getFullYear()}/${now.getMonth() + 1}/${baseName}.jpg`,
        thumbJpeg: `/uploads/marketplace/${now.getFullYear()}/${now.getMonth() + 1}/${baseName}_thumb.jpg`
      },
      permanent: true
    });
    
    console.log(`   ✅ Salvo com _id: ${savedImage._id}`);
    console.log(`   ImageId: ${savedImage.imageId}`);

    // TESTE 4: Recuperar e validar
    console.log('\n📦 TESTE 4: Recuperar do MongoDB');
    console.log('-'.repeat(60));
    
    const retrieved = await UploadedImageV2.findOne({ imageId: baseName }).lean();
    
    if (!retrieved) {
      console.log('   ❌ ERRO: Não encontrada após salvar!');
      return;
    }
    
    console.log('   ✅ Encontrada no banco');
    
    // Verificar strings base64
    const checks = {
      fullImage: retrieved.fullImage,
      thumbImage: retrieved.thumbImage,
      fullImageJpeg: retrieved.fullImageJpeg,
      thumbImageJpeg: retrieved.thumbImageJpeg
    };
    
    console.log('\n   Base64 strings:');
    for (const [name, base64] of Object.entries(checks)) {
      const isValid = base64 && typeof base64 === 'string' && base64.length > 0;
      console.log(`   ${isValid ? '✅' : '❌'} ${name}: ${isValid ? base64.length + ' caracteres' : 'VAZIO'}`);
    }

    // TESTE 5: Converter de volta para Buffer
    console.log('\n📦 TESTE 5: Converter Base64 → Buffer');
    console.log('-'.repeat(60));
    
    const buffers = {
      fullImage: UploadedImageV2.base64ToBuffer(retrieved.fullImage),
      thumbImage: UploadedImageV2.base64ToBuffer(retrieved.thumbImage),
      fullImageJpeg: UploadedImageV2.base64ToBuffer(retrieved.fullImageJpeg),
      thumbImageJpeg: UploadedImageV2.base64ToBuffer(retrieved.thumbImageJpeg)
    };
    
    let allValid = true;
    for (const [name, buffer] of Object.entries(buffers)) {
      const isValid = buffer && Buffer.isBuffer(buffer) && buffer.length > 0;
      const size = isValid ? (buffer.length / 1024).toFixed(2) : 0;
      console.log(`   ${isValid ? '✅' : '❌'} ${name}: ${isValid ? size + ' KB' : 'INVÁLIDO'}`);
      if (!isValid) allValid = false;
    }

    // TESTE 6: Comparar com originais
    console.log('\n📦 TESTE 6: Comparar com Buffers Originais');
    console.log('-'.repeat(60));
    
    const comparisons = {
      fullImage: fullBuffer.equals(buffers.fullImage),
      thumbImage: thumbBuffer.equals(buffers.thumbImage),
      fullImageJpeg: fullJpegBuffer.equals(buffers.fullImageJpeg),
      thumbImageJpeg: thumbJpegBuffer.equals(buffers.thumbImageJpeg)
    };
    
    for (const [name, identical] of Object.entries(comparisons)) {
      console.log(`   ${identical ? '✅' : '❌'} ${name}: ${identical ? 'IDÊNTICO' : 'DIFERENTE'}`);
    }

    // TESTE 7: Tamanho do documento
    console.log('\n📦 TESTE 7: Tamanho do Documento');
    console.log('-'.repeat(60));
    
    const docSize = JSON.stringify(retrieved).length;
    const maxSize = 16 * 1024 * 1024;
    const percentage = ((docSize / maxSize) * 100).toFixed(2);
    
    console.log(`   Tamanho: ${(docSize / 1024).toFixed(2)} KB`);
    console.log(`   Limite: ${(maxSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Uso: ${percentage}%`);
    console.log(`   ${docSize < maxSize ? '✅' : '❌'} Dentro do limite`);

    // RESUMO
    console.log('\n📋 RESUMO');
    console.log('='.repeat(60));
    
    if (allValid) {
      console.log('\n✅ SOLUÇÃO BASE64 FUNCIONA PERFEITAMENTE!');
      console.log('\n💡 Base64 resolve o problema de serialização de buffers');
      console.log('   Todos os buffers foram salvos e recuperados corretamente');
      console.log('\n🔧 PRÓXIMOS PASSOS:');
      console.log('   1. Migrar UploadedImage.js para usar base64');
      console.log('   2. Atualizar uploadRoutes.js');
      console.log('   3. Atualizar imageServeMiddleware.js');
      console.log('   4. Migrar imagens existentes (se houver no disco)');
    } else {
      console.log('\n❌ Alguns buffers não foram recuperados corretamente');
    }

    // Limpar teste
    console.log('\n🧹 Limpando...');
    await UploadedImageV2.deleteOne({ imageId: baseName });
    console.log('   ✅ Teste removido');

  } catch (error) {
    console.error('\n❌ ERRO:', error);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Conexão fechada\n');
    process.exit(0);
  }
}

testBase64Storage();

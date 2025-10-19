require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * Script para testar o fluxo completo de upload de imagens
 * Simula o processo que acontece no uploadRoutes.js
 */

async function testUploadFlow() {
  console.log('🧪 TESTE DO FLUXO COMPLETO DE UPLOAD\n');
  console.log('=' .repeat(60));
  
  try {
    // 1. CONECTAR AO MONGODB
    console.log('\n📡 1. CONECTANDO AO MONGODB');
    console.log('-'.repeat(60));
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado');

    // 2. CRIAR IMAGEM DE TESTE
    console.log('\n🎨 2. CRIANDO IMAGEM DE TESTE');
    console.log('-'.repeat(60));
    
    // Criar uma imagem simples de 500x500 pixels
    const testImageBuffer = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 138, g: 43, b: 226, alpha: 1 } // roxo
      }
    })
    .png()
    .toBuffer();
    
    console.log(`✅ Imagem de teste criada: ${(testImageBuffer.length / 1024).toFixed(2)} KB`);

    // 3. PROCESSAR IMAGEM (como no uploadRoutes.js)
    console.log('\n⚙️  3. PROCESSANDO IMAGEM');
    console.log('-'.repeat(60));
    
    const image = sharp(testImageBuffer, { failOnError: false });
    const metadata = await image.metadata();
    
    console.log(`   Dimensões: ${metadata.width} x ${metadata.height}`);
    console.log(`   Formato original: ${metadata.format}`);

    // Criar versões processadas
    console.log('\n   Processando variantes...');
    
    const fullBuffer = await image.clone()
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 45 })
      .toBuffer();
    console.log(`   ✅ Full AVIF: ${(fullBuffer.length / 1024).toFixed(2)} KB`);

    const fullJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, mozjpeg: true })
      .toBuffer();
    console.log(`   ✅ Full JPEG: ${(fullJpegBuffer.length / 1024).toFixed(2)} KB`);

    const thumbBuffer = await image.clone()
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 40 })
      .toBuffer();
    console.log(`   ✅ Thumb AVIF: ${(thumbBuffer.length / 1024).toFixed(2)} KB`);

    const thumbJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, progressive: true, mozjpeg: true })
      .toBuffer();
    console.log(`   ✅ Thumb JPEG: ${(thumbJpegBuffer.length / 1024).toFixed(2)} KB`);

    // 4. VALIDAR BUFFERS
    console.log('\n✅ 4. VALIDANDO BUFFERS');
    console.log('-'.repeat(60));
    
    const buffers = {
      fullBuffer,
      thumbBuffer,
      fullJpegBuffer,
      thumbJpegBuffer
    };
    
    let allValid = true;
    for (const [name, buffer] of Object.entries(buffers)) {
      const isValid = buffer && Buffer.isBuffer(buffer) && buffer.length > 0;
      console.log(`   ${isValid ? '✅' : '❌'} ${name}: ${isValid ? 'VÁLIDO' : 'INVÁLIDO'}`);
      if (!isValid) allValid = false;
    }
    
    if (!allValid) {
      console.log('\n❌ ERRO: Alguns buffers são inválidos!');
      return;
    }

    // 5. CRIAR DOCUMENTO NO MONGODB
    console.log('\n💾 5. SALVANDO NO MONGODB');
    console.log('-'.repeat(60));
    
    const now = new Date();
    const subPath = `marketplace/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}`;
    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    const publicFull = `/uploads/${subPath}/${baseName}.avif`;
    const publicThumb = `/uploads/${subPath}/${baseName}_thumb.avif`;
    const publicFullJpeg = `/uploads/${subPath}/${baseName}.jpg`;
    const publicThumbJpeg = `/uploads/${subPath}/${baseName}_thumb.jpg`;
    
    console.log(`   ImageId: ${baseName}`);
    console.log(`   Tipo: marketplace`);
    console.log(`   URL Full AVIF: ${publicFull}`);

    const savedImage = await UploadedImage.createFromBuffers({
      imageId: baseName,
      conversationId: null,
      imageType: 'marketplace',
      fullImage: fullBuffer,
      thumbImage: thumbBuffer,
      fullImageJpeg: fullJpegBuffer,
      thumbImageJpeg: thumbJpegBuffer,
      metadata: {
        originalName: 'test-image.png',
        originalSize: testImageBuffer.length,
        originalMimeType: 'image/png',
        width: metadata.width,
        height: metadata.height
      },
      urls: {
        full: publicFull,
        thumb: publicThumb,
        fullJpeg: publicFullJpeg,
        thumbJpeg: publicThumbJpeg
      },
      permanent: true
    });

    if (!savedImage || !savedImage.imageId) {
      console.log('   ❌ ERRO: Falha ao salvar no MongoDB!');
      return;
    }

    console.log('   ✅ Salvo com sucesso!');
    console.log(`   _id: ${savedImage._id}`);

    // 6. VERIFICAR SE FOI SALVO CORRETAMENTE
    console.log('\n🔍 6. VERIFICANDO INTEGRIDADE');
    console.log('-'.repeat(60));
    
    const retrieved = await UploadedImage.findOne({ imageId: baseName }).lean();
    
    if (!retrieved) {
      console.log('   ❌ ERRO: Imagem não foi encontrada após salvar!');
      return;
    }
    
    console.log('   ✅ Imagem encontrada no banco');
    
    // Verificar strings base64 recuperadas
    const retrievedBase64 = {
      fullImage: retrieved.fullImage,
      thumbImage: retrieved.thumbImage,
      fullImageJpeg: retrieved.fullImageJpeg,
      thumbImageJpeg: retrieved.thumbImageJpeg
    };
    
    let allRetrievedValid = true;
    console.log('   Verificando strings base64:');
    for (const [name, base64] of Object.entries(retrievedBase64)) {
      const isValid = base64 && typeof base64 === 'string' && base64.length > 0;
      console.log(`   ${isValid ? '✅' : '❌'} ${name}: ${isValid ? base64.length + ' caracteres' : 'VAZIO/INVÁLIDO'}`);
      if (!isValid) allRetrievedValid = false;
    }
    
    // Converter base64 para buffers e verificar
    console.log('\n   Convertendo para buffers:');
    const retrievedBuffers = {
      fullImage: UploadedImage.base64ToBuffer(retrieved.fullImage),
      thumbImage: UploadedImage.base64ToBuffer(retrieved.thumbImage),
      fullImageJpeg: UploadedImage.base64ToBuffer(retrieved.fullImageJpeg),
      thumbImageJpeg: UploadedImage.base64ToBuffer(retrieved.thumbImageJpeg)
    };
    
    for (const [name, buffer] of Object.entries(retrievedBuffers)) {
      const isValid = buffer && Buffer.isBuffer(buffer) && buffer.length > 0;
      const size = isValid ? (buffer.length / 1024).toFixed(2) : 0;
      console.log(`   ${isValid ? '✅' : '❌'} ${name}: ${isValid ? size + ' KB' : 'VAZIO/INVÁLIDO'}`);
      if (!isValid) allRetrievedValid = false;
    }

    // 7. SIMULAR ACESSO VIA MIDDLEWARE
    console.log('\n🌐 7. SIMULANDO ACESSO VIA MIDDLEWARE');
    console.log('-'.repeat(60));
    
    const testUrl = publicFull;
    const fileName = path.basename(testUrl);
    console.log(`   URL de teste: ${testUrl}`);
    console.log(`   Nome do arquivo: ${fileName}`);
    
    const match = fileName.match(/^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i);
    if (!match) {
      console.log('   ❌ ERRO: Regex não reconheceu o padrão!');
      return;
    }
    
    const imageId = match[1];
    console.log(`   ✅ ImageId extraído: ${imageId}`);
    
    const foundByMiddleware = await UploadedImage.findOne({ imageId }).lean();
    if (!foundByMiddleware) {
      console.log('   ❌ ERRO: Middleware não conseguiria encontrar a imagem!');
      return;
    }
    
    console.log('   ✅ Middleware conseguiria encontrar a imagem');
    
    // Verificar base64
    const base64ToServe = foundByMiddleware.fullImage;
    if (!base64ToServe || typeof base64ToServe !== 'string' || base64ToServe.length === 0) {
      console.log('   ❌ ERRO: Base64 não seria servido (vazio/inválido)');
      return;
    }
    console.log(`   ✅ Base64 encontrado: ${base64ToServe.length} caracteres`);
    
    // Converter para buffer
    const bufferToServe = UploadedImage.base64ToBuffer(base64ToServe);
    if (bufferToServe && Buffer.isBuffer(bufferToServe) && bufferToServe.length > 0) {
      console.log(`   ✅ Buffer seria servido: ${(bufferToServe.length / 1024).toFixed(2)} KB`);
    } else {
      console.log('   ❌ ERRO: Conversão base64→buffer falhou');
      return;
    }

    // 8. RESUMO FINAL
    console.log('\n📊 8. RESUMO DO TESTE');
    console.log('='.repeat(60));
    
    if (allValid && allRetrievedValid) {
      console.log('\n✅ TESTE COMPLETO - TUDO FUNCIONANDO!');
      console.log('\n📝 Imagem de teste criada com sucesso:');
      console.log(`   ImageId: ${baseName}`);
      console.log(`   URL: ${process.env.CHAT_PUBLIC_BASE_URL || 'http://localhost:5000'}${publicFull}`);
      console.log('\n💡 Você pode testar acessando essa URL no navegador');
      console.log('\n🧹 Para limpar esta imagem de teste:');
      console.log(`   Use: db.uploadedimages.deleteOne({imageId: "${baseName}"})`);
    } else {
      console.log('\n❌ TESTE FALHOU');
      console.log('   Verifique os erros acima');
    }

  } catch (error) {
    console.error('\n❌ ERRO NO TESTE:', error);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Conexão fechada\n');
    process.exit(0);
  }
}

testUploadFlow();

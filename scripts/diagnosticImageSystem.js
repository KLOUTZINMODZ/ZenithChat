require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');
const path = require('path');
const fs = require('fs');

/**
 * Script de Diagnóstico Completo do Sistema de Imagens
 * Verifica toda a cadeia: upload → armazenamento → recuperação
 */

const testImageUrl = 'https://zenith.enrelyugi.com.br/uploads/marketplace/2025/10/1760889095249_ve5m4a7ykn.avif';

async function diagnosticImageSystem() {
  console.log('🔍 DIAGNÓSTICO COMPLETO DO SISTEMA DE IMAGENS\n');
  console.log('=' .repeat(60));
  
  try {
    // 1. CONECTAR AO MONGODB
    console.log('\n📡 1. CONEXÃO COM MONGODB');
    console.log('-'.repeat(60));
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');
    console.log(`   Database: ${mongoose.connection.name}`);
    console.log(`   Host: ${mongoose.connection.host}`);

    // 2. EXTRAIR INFORMAÇÕES DA URL
    console.log('\n🔗 2. ANÁLISE DA URL');
    console.log('-'.repeat(60));
    console.log(`   URL completa: ${testImageUrl}`);
    
    const urlPath = new URL(testImageUrl).pathname;
    console.log(`   Path: ${urlPath}`);
    
    // Extrair imageId
    const fileName = path.basename(urlPath);
    console.log(`   Nome do arquivo: ${fileName}`);
    
    const match = fileName.match(/^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i);
    if (!match) {
      console.log('❌ ERRO: Padrão de nome de arquivo não reconhecido!');
      console.log(`   Esperado: TIMESTAMP_ID.extensão`);
      console.log(`   Recebido: ${fileName}`);
      return;
    }
    
    const imageId = match[1];
    console.log(`✅ ImageId extraído: ${imageId}`);
    
    const isThumb = fileName.includes('_thumb');
    const isJpeg = fileName.match(/\.jpe?g$/i);
    console.log(`   É thumbnail? ${isThumb ? 'Sim' : 'Não'}`);
    console.log(`   É JPEG? ${isJpeg ? 'Sim' : 'Não (AVIF)'}`);

    // 3. VERIFICAR NO BANCO DE DADOS
    console.log('\n💾 3. VERIFICAÇÃO NO BANCO DE DADOS');
    console.log('-'.repeat(60));
    
    const dbImage = await UploadedImage.findOne({ imageId }).lean();
    
    if (!dbImage) {
      console.log(`❌ IMAGEM NÃO ENCONTRADA NO BANCO!`);
      console.log(`   ImageId buscado: ${imageId}`);
      
      // Listar imagens similares
      const similar = await UploadedImage.find({
        imageId: new RegExp(imageId.substring(0, 10), 'i')
      }).limit(5).select('imageId imageType uploadedAt').lean();
      
      if (similar.length > 0) {
        console.log(`\n   📋 Imagens similares encontradas:`);
        similar.forEach(img => {
          console.log(`      - ${img.imageId} (${img.imageType}) - ${new Date(img.uploadedAt).toLocaleString('pt-BR')}`);
        });
      }
      
      // Estatísticas gerais
      const totalImages = await UploadedImage.countDocuments();
      const marketplaceImages = await UploadedImage.countDocuments({ imageType: 'marketplace' });
      const conversationImages = await UploadedImage.countDocuments({ imageType: 'conversation' });
      
      console.log(`\n   📊 Estatísticas do banco:`);
      console.log(`      Total: ${totalImages} imagens`);
      console.log(`      Marketplace: ${marketplaceImages}`);
      console.log(`      Conversas: ${conversationImages}`);
      
    } else {
      console.log(`✅ IMAGEM ENCONTRADA NO BANCO!`);
      console.log(`   ImageId: ${dbImage.imageId}`);
      console.log(`   Tipo: ${dbImage.imageType}`);
      console.log(`   Upload: ${new Date(dbImage.uploadedAt).toLocaleString('pt-BR')}`);
      console.log(`   ConversationId: ${dbImage.conversationId || 'N/A'}`);
      
      // Verificar buffers
      console.log(`\n   📦 Verificação de buffers:`);
      const buffers = {
        fullImage: dbImage.fullImage,
        thumbImage: dbImage.thumbImage,
        fullImageJpeg: dbImage.fullImageJpeg,
        thumbImageJpeg: dbImage.thumbImageJpeg
      };
      
      for (const [name, buffer] of Object.entries(buffers)) {
        const exists = buffer && Buffer.isBuffer(buffer);
        const size = exists ? buffer.length : 0;
        const sizeKb = (size / 1024).toFixed(2);
        
        if (exists && size > 0) {
          console.log(`      ✅ ${name}: ${sizeKb} KB`);
        } else {
          console.log(`      ❌ ${name}: VAZIO ou INVÁLIDO`);
        }
      }
      
      // Verificar qual buffer deve ser servido
      const bufferToServe = isThumb 
        ? (isJpeg ? dbImage.thumbImageJpeg : dbImage.thumbImage)
        : (isJpeg ? dbImage.fullImageJpeg : dbImage.fullImage);
      
      const bufferName = isThumb 
        ? (isJpeg ? 'thumbImageJpeg' : 'thumbImage')
        : (isJpeg ? 'fullImageJpeg' : 'fullImage');
      
      console.log(`\n   🎯 Buffer que deve ser servido: ${bufferName}`);
      
      if (bufferToServe && Buffer.isBuffer(bufferToServe) && bufferToServe.length > 0) {
        console.log(`   ✅ Buffer válido: ${(bufferToServe.length / 1024).toFixed(2)} KB`);
      } else {
        console.log(`   ❌ Buffer INVÁLIDO ou VAZIO!`);
      }
      
      // URLs armazenadas
      if (dbImage.urls) {
        console.log(`\n   🔗 URLs armazenadas:`);
        console.log(`      Full AVIF: ${dbImage.urls.full || 'N/A'}`);
        console.log(`      Thumb AVIF: ${dbImage.urls.thumb || 'N/A'}`);
        console.log(`      Full JPEG: ${dbImage.urls.fullJpeg || 'N/A'}`);
        console.log(`      Thumb JPEG: ${dbImage.urls.thumbJpeg || 'N/A'}`);
      }
      
      // Metadados
      if (dbImage.metadata) {
        console.log(`\n   ℹ️  Metadados:`);
        console.log(`      Nome original: ${dbImage.metadata.originalName || 'N/A'}`);
        console.log(`      Tamanho original: ${dbImage.metadata.originalSize ? (dbImage.metadata.originalSize / 1024).toFixed(2) + ' KB' : 'N/A'}`);
        console.log(`      MIME original: ${dbImage.metadata.originalMimeType || 'N/A'}`);
        console.log(`      Dimensões: ${dbImage.metadata.width || '?'} x ${dbImage.metadata.height || '?'}`);
      }
    }

    // 4. VERIFICAR NO DISCO
    console.log('\n💿 4. VERIFICAÇÃO NO SISTEMA DE ARQUIVOS');
    console.log('-'.repeat(60));
    
    const diskPath = path.join(__dirname, '..', 'uploads', 'marketplace', '2025', '10', fileName);
    console.log(`   Path no disco: ${diskPath}`);
    
    if (fs.existsSync(diskPath)) {
      const stats = fs.statSync(diskPath);
      console.log(`   ✅ Arquivo encontrado no disco!`);
      console.log(`      Tamanho: ${(stats.size / 1024).toFixed(2)} KB`);
      console.log(`      Modificado: ${stats.mtime.toLocaleString('pt-BR')}`);
    } else {
      console.log(`   ❌ Arquivo NÃO encontrado no disco`);
      console.log(`   ⚠️  Isso é esperado em ambientes serverless`);
    }

    // 5. TESTAR REGEX DO MIDDLEWARE
    console.log('\n🧪 5. TESTE DO REGEX DO MIDDLEWARE');
    console.log('-'.repeat(60));
    
    const regexTests = [
      { pattern: /\.(avif|jpg|jpeg|png)$/i, name: 'Extensão válida' },
      { pattern: /^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i, name: 'Padrão de nome' }
    ];
    
    regexTests.forEach(test => {
      const matches = fileName.match(test.pattern);
      console.log(`   ${matches ? '✅' : '❌'} ${test.name}: ${matches ? 'OK' : 'FALHOU'}`);
      if (matches && matches[1]) {
        console.log(`      Capturado: ${matches[1]}`);
      }
    });

    // 6. RESUMO E DIAGNÓSTICO
    console.log('\n📋 6. RESUMO E DIAGNÓSTICO');
    console.log('='.repeat(60));
    
    if (!dbImage) {
      console.log('\n❌ PROBLEMA IDENTIFICADO:');
      console.log('   A imagem NÃO ESTÁ NO BANCO DE DADOS');
      console.log('\n🔧 POSSÍVEIS CAUSAS:');
      console.log('   1. Upload falhou ao salvar no MongoDB');
      console.log('   2. Imagem foi deletada do banco');
      console.log('   3. Upload foi feito antes da migração para MongoDB');
      console.log('   4. ImageId está incorreto ou não corresponde');
      console.log('\n💡 SOLUÇÕES:');
      console.log('   1. Faça novo upload da imagem');
      console.log('   2. Execute: npm run images:migrate (se imagem estiver no disco)');
      console.log('   3. Verifique logs de erro do upload');
    } else {
      const bufferToServe = isThumb 
        ? (isJpeg ? dbImage.thumbImageJpeg : dbImage.thumbImage)
        : (isJpeg ? dbImage.fullImageJpeg : dbImage.fullImage);
      
      if (bufferToServe && Buffer.isBuffer(bufferToServe) && bufferToServe.length > 0) {
        console.log('\n✅ SISTEMA FUNCIONANDO CORRETAMENTE!');
        console.log('   A imagem está no banco com buffer válido');
        console.log('   O middleware deve servir a imagem corretamente');
        console.log('\n🔍 Se ainda recebe erro 404, verifique:');
        console.log('   1. Servidor está rodando?');
        console.log('   2. Middleware imageServeMiddleware está ativo?');
        console.log('   3. URL está acessível externamente?');
      } else {
        console.log('\n❌ PROBLEMA IDENTIFICADO:');
        console.log('   Imagem EXISTE no banco mas o BUFFER está VAZIO/CORROMPIDO');
        console.log('\n🔧 POSSÍVEIS CAUSAS:');
        console.log('   1. Falha no processamento da imagem durante upload');
        console.log('   2. Corrupção de dados no MongoDB');
        console.log('   3. Migração incompleta');
        console.log('\n💡 SOLUÇÕES:');
        console.log('   1. Execute: npm run images:clean (remove corrompidas)');
        console.log('   2. Faça novo upload da imagem');
      }
    }

  } catch (error) {
    console.error('\n❌ ERRO NO DIAGNÓSTICO:', error);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Conexão fechada\n');
    process.exit(0);
  }
}

diagnosticImageSystem();

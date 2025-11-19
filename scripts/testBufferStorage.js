require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Script para testar salvamento e recuperação de buffers no MongoDB
 * Identifica se o problema é no driver, schema ou configuração
 */

async function testBufferStorage() {
  console.log('🧪 TESTE DE ARMAZENAMENTO DE BUFFERS NO MONGODB\n');
  console.log('='.repeat(60));
  
  try {
    // Conectar
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    // Criar schema de teste simples
    const TestSchema = new mongoose.Schema({
      testId: String,
      smallBuffer: Buffer,
      mediumBuffer: Buffer,
      largeBuffer: Buffer,
      explicitBuffer: mongoose.Schema.Types.Buffer
    });
    
    const TestModel = mongoose.model('BufferTest', TestSchema);

    // Limpar testes anteriores
    await TestModel.deleteMany({ testId: /^test/ });

    // TESTE 1: Buffer pequeno (1KB)
    console.log('📦 TESTE 1: Buffer Pequeno (1KB)');
    console.log('-'.repeat(60));
    
    const smallBuffer = Buffer.alloc(1024, 'A');
    console.log(`   Criado: ${smallBuffer.length} bytes`);
    
    const doc1 = await TestModel.create({
      testId: 'test-small',
      smallBuffer: smallBuffer
    });
    console.log(`   ✅ Salvo com _id: ${doc1._id}`);
    
    const retrieved1 = await TestModel.findById(doc1._id).lean();
    const isValid1 = retrieved1.smallBuffer && Buffer.isBuffer(retrieved1.smallBuffer) && retrieved1.smallBuffer.length > 0;
    console.log(`   ${isValid1 ? '✅' : '❌'} Recuperado: ${isValid1 ? retrieved1.smallBuffer.length + ' bytes' : 'VAZIO/INVÁLIDO'}`);

    // TESTE 2: Buffer médio (100KB - típico de thumbnail)
    console.log('\n📦 TESTE 2: Buffer Médio (100KB)');
    console.log('-'.repeat(60));
    
    const mediumBuffer = Buffer.alloc(100 * 1024, 'B');
    console.log(`   Criado: ${(mediumBuffer.length / 1024).toFixed(2)} KB`);
    
    const doc2 = await TestModel.create({
      testId: 'test-medium',
      mediumBuffer: mediumBuffer
    });
    console.log(`   ✅ Salvo com _id: ${doc2._id}`);
    
    const retrieved2 = await TestModel.findById(doc2._id).lean();
    const isValid2 = retrieved2.mediumBuffer && Buffer.isBuffer(retrieved2.mediumBuffer) && retrieved2.mediumBuffer.length > 0;
    console.log(`   ${isValid2 ? '✅' : '❌'} Recuperado: ${isValid2 ? (retrieved2.mediumBuffer.length / 1024).toFixed(2) + ' KB' : 'VAZIO/INVÁLIDO'}`);

    // TESTE 3: Buffer grande (1MB - típico de imagem full)
    console.log('\n📦 TESTE 3: Buffer Grande (1MB)');
    console.log('-'.repeat(60));
    
    const largeBuffer = Buffer.alloc(1024 * 1024, 'C');
    console.log(`   Criado: ${(largeBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    const doc3 = await TestModel.create({
      testId: 'test-large',
      largeBuffer: largeBuffer
    });
    console.log(`   ✅ Salvo com _id: ${doc3._id}`);
    
    const retrieved3 = await TestModel.findById(doc3._id).lean();
    const isValid3 = retrieved3.largeBuffer && Buffer.isBuffer(retrieved3.largeBuffer) && retrieved3.largeBuffer.length > 0;
    console.log(`   ${isValid3 ? '✅' : '❌'} Recuperado: ${isValid3 ? (retrieved3.largeBuffer.length / 1024 / 1024).toFixed(2) + ' MB' : 'VAZIO/INVÁLIDO'}`);

    // TESTE 4: Usando Schema.Types.Buffer explícito
    console.log('\n📦 TESTE 4: Schema.Types.Buffer Explícito (500KB)');
    console.log('-'.repeat(60));
    
    const explicitBuffer = Buffer.alloc(500 * 1024, 'D');
    console.log(`   Criado: ${(explicitBuffer.length / 1024).toFixed(2)} KB`);
    
    const doc4 = await TestModel.create({
      testId: 'test-explicit',
      explicitBuffer: explicitBuffer
    });
    console.log(`   ✅ Salvo com _id: ${doc4._id}`);
    
    const retrieved4 = await TestModel.findById(doc4._id).lean();
    const isValid4 = retrieved4.explicitBuffer && Buffer.isBuffer(retrieved4.explicitBuffer) && retrieved4.explicitBuffer.length > 0;
    console.log(`   ${isValid4 ? '✅' : '❌'} Recuperado: ${isValid4 ? (retrieved4.explicitBuffer.length / 1024).toFixed(2) + ' KB' : 'VAZIO/INVÁLIDO'}`);

    // TESTE 5: Múltiplos buffers no mesmo documento (simulando UploadedImage)
    console.log('\n📦 TESTE 5: Múltiplos Buffers (como UploadedImage)');
    console.log('-'.repeat(60));
    
    const multiDoc = await TestModel.create({
      testId: 'test-multi',
      smallBuffer: Buffer.alloc(50 * 1024, 'X'),   // 50KB
      mediumBuffer: Buffer.alloc(100 * 1024, 'Y'),  // 100KB
      largeBuffer: Buffer.alloc(200 * 1024, 'Z'),   // 200KB
      explicitBuffer: Buffer.alloc(150 * 1024, 'W') // 150KB
    });
    
    const totalSize = (50 + 100 + 200 + 150) * 1024;
    console.log(`   Criado documento com 4 buffers: ${(totalSize / 1024).toFixed(2)} KB total`);
    console.log(`   ✅ Salvo com _id: ${multiDoc._id}`);
    
    const retrievedMulti = await TestModel.findById(multiDoc._id).lean();
    console.log(`\n   Recuperação individual:`);
    
    const checks = {
      smallBuffer: retrievedMulti.smallBuffer,
      mediumBuffer: retrievedMulti.mediumBuffer,
      largeBuffer: retrievedMulti.largeBuffer,
      explicitBuffer: retrievedMulti.explicitBuffer
    };
    
    for (const [name, buffer] of Object.entries(checks)) {
      const valid = buffer && Buffer.isBuffer(buffer) && buffer.length > 0;
      const size = valid ? (buffer.length / 1024).toFixed(2) : 0;
      console.log(`   ${valid ? '✅' : '❌'} ${name}: ${valid ? size + ' KB' : 'VAZIO/INVÁLIDO'}`);
    }

    // VERIFICAR TAMANHO DO DOCUMENTO
    console.log('\n📊 VERIFICAÇÃO DE TAMANHO DE DOCUMENTO');
    console.log('-'.repeat(60));
    
    const docSize = JSON.stringify(retrievedMulti).length;
    const maxSize = 16 * 1024 * 1024; // 16MB limite do MongoDB
    const percentage = ((docSize / maxSize) * 100).toFixed(2);
    
    console.log(`   Tamanho do documento: ${(docSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Limite do MongoDB: ${(maxSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Uso: ${percentage}%`);
    console.log(`   ${docSize < maxSize ? '✅' : '❌'} ${docSize < maxSize ? 'Dentro do limite' : 'EXCEDEU O LIMITE!'}`);

    // RESUMO
    console.log('\n📋 RESUMO DOS TESTES');
    console.log('='.repeat(60));
    
    const allValid = isValid1 && isValid2 && isValid3 && isValid4;
    
    if (allValid) {
      console.log('\n✅ TODOS OS TESTES PASSARAM!');
      console.log('   MongoDB está salvando e recuperando buffers corretamente');
      console.log('\n🔍 O problema pode estar em:');
      console.log('   1. Código de upload (uploadRoutes.js)');
      console.log('   2. Processamento com Sharp');
      console.log('   3. Validação dos buffers antes de salvar');
    } else {
      console.log('\n❌ ALGUNS TESTES FALHARAM!');
      console.log('   MongoDB NÃO está salvando/recuperando buffers corretamente');
      console.log('\n🔧 Possíveis causas:');
      console.log('   1. Problema com driver do MongoDB');
      console.log('   2. Versão do Mongoose incompatível');
      console.log('   3. Configuração do cluster MongoDB');
      console.log('   4. Buffers excedendo limite de documento (16MB)');
    }

    // Limpar testes
    console.log('\n🧹 Limpando testes...');
    const deleted = await TestModel.deleteMany({ testId: /^test/ });
    console.log(`   ✅ ${deleted.deletedCount} documentos de teste removidos`);

  } catch (error) {
    console.error('\n❌ ERRO NO TESTE:', error);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Conexão fechada\n');
    process.exit(0);
  }
}

testBufferStorage();

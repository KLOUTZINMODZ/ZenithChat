const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://ZenithDB:3j6GEM4Si2UtgUx8@zenith.vngshrt.mongodb.net/test?retryWrites=true&w=majority';

async function fixIndex() {
  try {
    console.log('🔌 Conectando ao MongoDB...');
    console.log('📍 URI:', MONGODB_URI.replace(/:[^:@]+@/, ':****@')); // Ocultar senha
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Conectado com sucesso!\n');
    
    const db = mongoose.connection.db;
    const collection = db.collection('users');
    
    // Verificar índices atuais
    console.log('📋 Verificando índices atuais...');
    const indexes = await collection.indexes();
    
    console.log(`\n📊 Total de índices encontrados: ${indexes.length}\n`);
    
    // Procurar índice pixKeyFingerprint
    const pixKeyIndex = indexes.find(idx => idx.key && idx.key.pixKeyFingerprint);
    
    if (pixKeyIndex) {
      console.log('✅ Índice pixKeyFingerprint encontrado:');
      console.log('   Nome:', pixKeyIndex.name);
      console.log('   Unique:', pixKeyIndex.unique);
      console.log('   Sparse:', pixKeyIndex.sparse);
      console.log('   Key:', JSON.stringify(pixKeyIndex.key));
      
      // Verificar se tem sparse
      if (!pixKeyIndex.sparse) {
        console.log('\n⚠️  PROBLEMA: Índice SEM sparse!');
        console.log('⚙️  Recriando índice com sparse: true...\n');
        
        // Remover índice antigo
        console.log('🗑️  Removendo índice antigo...');
        await collection.dropIndex(pixKeyIndex.name);
        console.log('✅ Índice antigo removido com sucesso\n');
        
        // Criar novo índice com sparse
        console.log('🔨 Criando novo índice com sparse: true...');
        await collection.createIndex(
          { pixKeyFingerprint: 1 },
          { unique: true, sparse: true, name: 'pixKeyFingerprint_1' }
        );
        console.log('✅ Novo índice criado com sucesso!\n');
      } else {
        console.log('\n✅ Índice já está correto (sparse: true)');
        console.log('ℹ️  Nenhuma ação necessária.\n');
      }
    } else {
      console.log('❌ Índice pixKeyFingerprint NÃO encontrado!');
      console.log('🔨 Criando índice...\n');
      
      await collection.createIndex(
        { pixKeyFingerprint: 1 },
        { unique: true, sparse: true, name: 'pixKeyFingerprint_1' }
      );
      console.log('✅ Índice criado com sucesso!\n');
    }
    
    // Verificar phoneNormalized também
    console.log('📋 Verificando índice phoneNormalized...');
    const phoneIndex = indexes.find(idx => idx.key && idx.key.phoneNormalized);
    
    if (phoneIndex && !phoneIndex.sparse) {
      console.log('⚠️  phoneNormalized também está sem sparse! Corrigindo...');
      
      await collection.dropIndex(phoneIndex.name);
      console.log('✅ Índice phoneNormalized antigo removido');
      
      await collection.createIndex(
        { phoneNormalized: 1 },
        { unique: true, sparse: true, name: 'phoneNormalized_1' }
      );
      console.log('✅ phoneNormalized recriado com sparse: true\n');
    } else if (phoneIndex) {
      console.log('✅ phoneNormalized já está correto\n');
    }
    
    // Verificar resultado final
    console.log('📋 Verificando índices após correção...');
    const finalIndexes = await collection.indexes();
    
    const finalPixKey = finalIndexes.find(idx => idx.key && idx.key.pixKeyFingerprint);
    const finalPhone = finalIndexes.find(idx => idx.key && idx.key.phoneNormalized);
    
    console.log('\n═══════════════════════════════════════');
    console.log('📊 RESULTADO FINAL:');
    console.log('═══════════════════════════════════════\n');
    
    if (finalPixKey) {
      console.log('✅ pixKeyFingerprint:');
      console.log('   - unique:', finalPixKey.unique);
      console.log('   - sparse:', finalPixKey.sparse);
    }
    
    if (finalPhone) {
      console.log('\n✅ phoneNormalized:');
      console.log('   - unique:', finalPhone.unique);
      console.log('   - sparse:', finalPhone.sparse);
    }
    
    console.log('\n═══════════════════════════════════════');
    console.log('✅ CORREÇÃO CONCLUÍDA COM SUCESSO!');
    console.log('═══════════════════════════════════════\n');
    
    console.log('ℹ️  Agora você pode registrar novos usuários normalmente.');
    console.log('ℹ️  Múltiplos usuários podem ter pixKeyFingerprint: null\n');
    
  } catch (error) {
    console.error('\n❌ ERRO:', error.message);
    console.error('\n📋 Detalhes completos:');
    console.error(error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Conexão com MongoDB fechada');
    process.exit(0);
  }
}

// Executar
console.log('\n╔═══════════════════════════════════════╗');
console.log('║   FIX: pixKeyFingerprint Index        ║');
console.log('╚═══════════════════════════════════════╝\n');

fixIndex();

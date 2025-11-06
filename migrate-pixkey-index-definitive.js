/**
 * 🔧 MIGRAÇÃO DEFINITIVA: Índice pixKeyFingerprint
 * 
 * Este script corrige PERMANENTEMENTE o problema do índice pixKeyFingerprint
 * que causava erro E11000 ao registrar usuários.
 * 
 * PROBLEMA:
 * - Índice estava sendo criado SEM sparse: true
 * - Múltiplos documentos com pixKeyFingerprint: null causavam erro
 * 
 * SOLUÇÃO:
 * - Remove TODOS os índices pixKeyFingerprint existentes
 * - Cria índice correto com { unique: true, sparse: true }
 * - Valida configuração final
 * 
 * EXECUÇÃO:
 * node migrate-pixkey-index-definitive.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ ERRO: MONGO_URI não encontrado no .env');
  process.exit(1);
}

async function migrateIndexDefinitive() {
  let connection;
  
  try {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║   MIGRAÇÃO DEFINITIVA: pixKeyFingerprint Index        ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
    console.log('🔌 Conectando ao MongoDB...');
    connection = await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Conectado com sucesso!\n');

    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 1: Listar todos os índices atuais
    // ═══════════════════════════════════════════════════════════════
    console.log('📋 ETAPA 1: Listando índices atuais...\n');
    const indexes = await collection.indexes();
    
    console.log(`Total de índices: ${indexes.length}\n`);
    
    const pixKeyIndexes = indexes.filter(idx => 
      idx.name && (
        idx.name.includes('pixKey') || 
        (idx.key && idx.key.pixKeyFingerprint)
      )
    );
    
    if (pixKeyIndexes.length > 0) {
      console.log('🔍 Índices relacionados ao pixKeyFingerprint encontrados:');
      pixKeyIndexes.forEach(idx => {
        console.log(`\n   📌 ${idx.name}`);
        console.log(`      - unique: ${idx.unique || false}`);
        console.log(`      - sparse: ${idx.sparse || false}`);
        console.log(`      - key:`, JSON.stringify(idx.key));
      });
      console.log('');
    } else {
      console.log('ℹ️  Nenhum índice pixKeyFingerprint encontrado.\n');
    }

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 2: Remover TODOS os índices pixKeyFingerprint existentes
    // ═══════════════════════════════════════════════════════════════
    console.log('🗑️  ETAPA 2: Removendo índices antigos...\n');
    
    let droppedCount = 0;
    for (const idx of pixKeyIndexes) {
      try {
        console.log(`   🗑️  Removendo: ${idx.name}...`);
        await collection.dropIndex(idx.name);
        console.log(`   ✅ Removido com sucesso!`);
        droppedCount++;
      } catch (error) {
        if (error.codeName === 'IndexNotFound') {
          console.log(`   ℹ️  Índice já não existe (OK)`);
        } else {
          console.log(`   ⚠️  Erro ao remover: ${error.message}`);
        }
      }
    }
    
    console.log(`\n   📊 Total removido: ${droppedCount} índice(s)\n`);

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 3: Criar índice correto com sparse: true
    // ═══════════════════════════════════════════════════════════════
    console.log('🔨 ETAPA 3: Criando índice correto...\n');
    
    try {
      await collection.createIndex(
        { pixKeyFingerprint: 1 },
        { 
          unique: true, 
          sparse: true, 
          name: 'pixKeyFingerprint_1',
          background: true // Cria em background para não bloquear
        }
      );
      console.log('   ✅ Índice criado com sucesso!');
      console.log('   📋 Configuração:');
      console.log('      - Campo: pixKeyFingerprint');
      console.log('      - unique: true');
      console.log('      - sparse: true');
      console.log('      - name: pixKeyFingerprint_1\n');
    } catch (error) {
      console.error(`   ❌ Erro ao criar índice: ${error.message}\n`);
      throw error;
    }

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 4: Validar configuração final
    // ═══════════════════════════════════════════════════════════════
    console.log('✅ ETAPA 4: Validando configuração final...\n');
    
    const finalIndexes = await collection.indexes();
    const finalPixKey = finalIndexes.find(idx => idx.key && idx.key.pixKeyFingerprint);
    
    if (!finalPixKey) {
      throw new Error('Índice pixKeyFingerprint não foi criado!');
    }
    
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║              VALIDAÇÃO DO ÍNDICE                      ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
    console.log('   📋 pixKeyFingerprint_1:');
    console.log(`      ✅ unique: ${finalPixKey.unique === true ? 'true' : '❌ FALSE'}`);
    console.log(`      ✅ sparse: ${finalPixKey.sparse === true ? 'true' : '❌ FALSE'}`);
    console.log(`      ✅ key: ${JSON.stringify(finalPixKey.key)}\n`);
    
    if (finalPixKey.unique && finalPixKey.sparse) {
      console.log('╔═══════════════════════════════════════════════════════╗');
      console.log('║              🎉 MIGRAÇÃO CONCLUÍDA! 🎉                ║');
      console.log('╚═══════════════════════════════════════════════════════╝\n');
      
      console.log('✅ O índice pixKeyFingerprint foi configurado corretamente!');
      console.log('✅ Agora múltiplos usuários podem ter pixKeyFingerprint: null');
      console.log('✅ O erro E11000 não deve mais ocorrer!\n');
      
      console.log('📋 PRÓXIMOS PASSOS:\n');
      console.log('   1. Reinicie a API: pm2 restart zenith-chat-api');
      console.log('   2. Teste o registro de novos usuários');
      console.log('   3. Monitore os logs para confirmar que o erro não ocorre\n');
      
      console.log('ℹ️  IMPORTANTE:');
      console.log('   - O modelo User.js foi atualizado com autoIndex: false');
      console.log('   - Isso previne que o Mongoose recrie índices incorretamente');
      console.log('   - Mantenha esta configuração em produção!\n');
    } else {
      throw new Error('Índice não está configurado corretamente!');
    }

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 5: Estatísticas dos dados
    // ═══════════════════════════════════════════════════════════════
    console.log('📊 ESTATÍSTICAS DOS DADOS:\n');
    
    const totalUsers = await collection.countDocuments();
    const usersWithPixKey = await collection.countDocuments({ 
      pixKeyFingerprint: { $ne: null } 
    });
    const usersWithoutPixKey = totalUsers - usersWithPixKey;
    
    console.log(`   👥 Total de usuários: ${totalUsers}`);
    console.log(`   🔑 Com PIX vinculado: ${usersWithPixKey}`);
    console.log(`   ⭕ Sem PIX (null): ${usersWithoutPixKey}\n`);
    
    console.log('✅ Todos os usuários com pixKeyFingerprint: null são permitidos!');
    console.log('✅ Apenas chaves PIX duplicadas serão rejeitadas.\n');

  } catch (error) {
    console.error('\n╔═══════════════════════════════════════════════════════╗');
    console.error('║                  ❌ ERRO CRÍTICO ❌                    ║');
    console.error('╚═══════════════════════════════════════════════════════╝\n');
    console.error(`Erro: ${error.message}\n`);
    console.error('Stack:', error.stack, '\n');
    
    console.log('🔧 SOLUÇÃO MANUAL:\n');
    console.log('   Conecte ao MongoDB e execute:\n');
    console.log('   use test  // ou sua database');
    console.log('   db.users.dropIndex("pixKeyFingerprint_1")');
    console.log('   db.users.createIndex({ pixKeyFingerprint: 1 }, { unique: true, sparse: true })\n');
    
    process.exit(1);
  } finally {
    if (connection) {
      console.log('🔌 Fechando conexão...');
      await mongoose.connection.close();
      console.log('✅ Conexão fechada.\n');
    }
  }
}

// Executar migração
console.log('\n🚀 Iniciando migração definitiva...\n');
migrateIndexDefinitive()
  .then(() => {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║           ✅ SCRIPT FINALIZADO COM SUCESSO ✅         ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script finalizado com erro:', error.message);
    process.exit(1);
  });

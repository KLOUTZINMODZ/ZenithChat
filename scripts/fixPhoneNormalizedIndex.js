/**
 * Script para corrigir o índice phoneNormalized_1
 * 
 * PROBLEMA: Índice único não permite múltiplos valores null
 * SOLUÇÃO: Criar índice único sparse (parcial) que ignora documentos com null
 * 
 * Erro original:
 * E11000 duplicate key error collection: test.users index: phoneNormalized_1 
 * dup key: { phoneNormalized: null }
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function fixPhoneNormalizedIndex() {
  try {
    console.log('🔧 Iniciando correção do índice phoneNormalized...\n');
    
    // Conectar ao MongoDB
    console.log('🔗 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    // 1. Verificar índices existentes
    console.log('📋 Índices atuais na coleção users:');
    const indexes = await usersCollection.indexes();
    indexes.forEach((index, i) => {
      console.log(`   ${i + 1}. ${index.name}:`, JSON.stringify(index.key), 
        index.unique ? '(ÚNICO)' : '', 
        index.sparse ? '(SPARSE)' : '');
    });
    console.log('');

    // 2. Verificar se o índice problemático existe
    const problematicIndex = indexes.find(idx => idx.name === 'phoneNormalized_1');
    
    if (problematicIndex) {
      console.log('⚠️  Índice problemático encontrado:', problematicIndex.name);
      console.log('   - Único:', problematicIndex.unique ? 'SIM' : 'NÃO');
      console.log('   - Sparse:', problematicIndex.sparse ? 'SIM' : 'NÃO');
      
      if (problematicIndex.unique && !problematicIndex.sparse) {
        console.log('\n❌ PROBLEMA CONFIRMADO: Índice único sem sparse\n');
        
        // 3. Contar usuários com phoneNormalized null
        const usersWithNullPhone = await usersCollection.countDocuments({ 
          phoneNormalized: null 
        });
        console.log(`📊 Usuários com phoneNormalized null: ${usersWithNullPhone}`);
        
        if (usersWithNullPhone > 1) {
          console.log('⚠️  Múltiplos usuários com phoneNormalized null detectados\n');
        }
        
        // 4. Remover índice antigo
        console.log('🗑️  Removendo índice antigo...');
        await usersCollection.dropIndex('phoneNormalized_1');
        console.log('✅ Índice antigo removido\n');
        
        // 5. Criar novo índice sparse
        console.log('🔨 Criando novo índice único sparse...');
        await usersCollection.createIndex(
          { phoneNormalized: 1 }, 
          { 
            unique: true, 
            sparse: true,  // ← CRUCIAL: Ignora documentos com null
            name: 'phoneNormalized_1'
          }
        );
        console.log('✅ Novo índice criado com sucesso\n');
        
        // 6. Verificar resultado
        console.log('📋 Índices após correção:');
        const newIndexes = await usersCollection.indexes();
        const newIndex = newIndexes.find(idx => idx.name === 'phoneNormalized_1');
        if (newIndex) {
          console.log('   phoneNormalized_1:');
          console.log('   - Único:', newIndex.unique ? 'SIM ✅' : 'NÃO');
          console.log('   - Sparse:', newIndex.sparse ? 'SIM ✅' : 'NÃO');
        }
        
        console.log('\n✅ Correção concluída com sucesso!');
        console.log('   Agora múltiplos usuários podem ter phoneNormalized null\n');
        
      } else if (problematicIndex.unique && problematicIndex.sparse) {
        console.log('\n✅ Índice já está correto (único + sparse)');
        console.log('   O erro pode ter outra causa. Verifique:\n');
        console.log('   1. Se há usuários duplicados com mesmo telefone não-null');
        console.log('   2. Logs de aplicação para mais detalhes');
        console.log('   3. Se o problema persiste após restart do servidor\n');
      }
    } else {
      console.log('ℹ️  Índice phoneNormalized_1 não encontrado');
      console.log('   Criando índice correto...\n');
      
      await usersCollection.createIndex(
        { phoneNormalized: 1 }, 
        { 
          unique: true, 
          sparse: true, 
          name: 'phoneNormalized_1'
        }
      );
      console.log('✅ Índice criado com sucesso\n');
    }

    // 7. Estatísticas finais
    console.log('═══════════════════════════════════════════════════');
    console.log('📊 ESTATÍSTICAS FINAIS');
    console.log('═══════════════════════════════════════════════════');
    
    const totalUsers = await usersCollection.countDocuments();
    const usersWithPhone = await usersCollection.countDocuments({ 
      phoneNormalized: { $ne: null } 
    });
    const usersWithoutPhone = await usersCollection.countDocuments({ 
      phoneNormalized: null 
    });
    
    console.log(`Total de usuários: ${totalUsers}`);
    console.log(`Com telefone: ${usersWithPhone}`);
    console.log(`Sem telefone (null): ${usersWithoutPhone}`);
    console.log('═══════════════════════════════════════════════════\n');
    
    console.log('✅ Script finalizado com sucesso!');
    console.log('   Você pode fazer login com Google OAuth agora.\n');

  } catch (error) {
    console.error('❌ Erro durante a correção:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Desconectado do MongoDB\n');
  }
}

// Executar script
fixPhoneNormalizedIndex();

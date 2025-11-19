/**
 * Script para corrigir dados existentes - phoneNormalized
 * 
 * PROBLEMA:
 * Usuários antigos podem ter phone definido mas phoneNormalized = null
 * Isso causa erro E11000 duplicate key error ao criar novos usuários
 * 
 * SOLUÇÃO:
 * 1. Buscar todos os usuários com phone mas sem phoneNormalized
 * 2. Normalizar e atualizar phoneNormalized
 * 3. Remover phoneNormalized null de usuários sem phone
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function fixPhoneNormalizedData() {
  try {
    console.log('🔧 [FIX] Iniciando correção de phoneNormalized...\n');
    
    // Conectar ao banco
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ [FIX] Conectado ao MongoDB\n');
    
    // 1. Encontrar usuários com phone mas phoneNormalized = null
    const usersWithPhoneButNoNormalized = await User.find({
      phone: { $exists: true, $ne: null, $ne: '' },
      $or: [
        { phoneNormalized: null },
        { phoneNormalized: { $exists: false } }
      ]
    });
    
    console.log(`📊 [FIX] Encontrados ${usersWithPhoneButNoNormalized.length} usuários com phone mas sem phoneNormalized`);
    
    if (usersWithPhoneButNoNormalized.length > 0) {
      console.log('\n🔄 [FIX] Corrigindo usuários...\n');
      
      for (const user of usersWithPhoneButNoNormalized) {
        const normalized = user.phone.replace(/\D/g, '');
        
        if (normalized.length > 0) {
          console.log(`  📱 ${user.email}`);
          console.log(`     Phone: ${user.phone}`);
          console.log(`     Normalized: ${normalized}`);
          
          // Atualizar diretamente (bypass do hook para evitar problemas)
          await User.updateOne(
            { _id: user._id },
            { $set: { phoneNormalized: normalized } }
          );
          
          console.log(`     ✅ Atualizado\n`);
        } else {
          console.log(`  ⚠️  ${user.email}: Phone inválido "${user.phone}" - removendo\n`);
          await User.updateOne(
            { _id: user._id },
            { $set: { phone: null, phoneNormalized: null } }
          );
        }
      }
    }
    
    // 2. Encontrar usuários sem phone mas com phoneNormalized definido
    const usersWithNormalizedButNoPhone = await User.find({
      $or: [
        { phone: null },
        { phone: { $exists: false } },
        { phone: '' }
      ],
      phoneNormalized: { $ne: null, $exists: true }
    });
    
    console.log(`\n📊 [FIX] Encontrados ${usersWithNormalizedButNoPhone.length} usuários sem phone mas com phoneNormalized`);
    
    if (usersWithNormalizedButNoPhone.length > 0) {
      console.log('\n🔄 [FIX] Limpando phoneNormalized desnecessário...\n');
      
      for (const user of usersWithNormalizedButNoPhone) {
        console.log(`  🧹 ${user.email}`);
        console.log(`     Removendo phoneNormalized: ${user.phoneNormalized}\n`);
        
        await User.updateOne(
          { _id: user._id },
          { $set: { phoneNormalized: null } }
        );
      }
    }
    
    // 3. Verificar duplicatas de phoneNormalized
    console.log('\n🔍 [FIX] Verificando duplicatas de phoneNormalized...\n');
    
    const duplicates = await User.aggregate([
      {
        $match: {
          phoneNormalized: { $ne: null }
        }
      },
      {
        $group: {
          _id: '$phoneNormalized',
          count: { $sum: 1 },
          users: { $push: { id: '$_id', email: '$email', phone: '$phone' } }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);
    
    if (duplicates.length > 0) {
      console.log(`⚠️  [FIX] ATENÇÃO: Encontradas ${duplicates.length} duplicatas de phoneNormalized:\n`);
      
      for (const dup of duplicates) {
        console.log(`  📱 Telefone normalizado: ${dup._id}`);
        console.log(`     Usado por ${dup.count} usuários:`);
        
        for (const user of dup.users) {
          console.log(`       - ${user.email} (${user.phone})`);
        }
        
        console.log('\n  🔧 AÇÃO NECESSÁRIA: Revisar manualmente e manter apenas um usuário com este telefone\n');
      }
    } else {
      console.log('✅ [FIX] Nenhuma duplicata encontrada\n');
    }
    
    // 4. Estatísticas finais
    const totalUsers = await User.countDocuments();
    const usersWithPhone = await User.countDocuments({ 
      phone: { $exists: true, $ne: null, $ne: '' } 
    });
    const usersWithPhoneNormalized = await User.countDocuments({ 
      phoneNormalized: { $exists: true, $ne: null } 
    });
    
    console.log('📊 [FIX] Estatísticas Finais:');
    console.log(`   Total de usuários: ${totalUsers}`);
    console.log(`   Com phone: ${usersWithPhone}`);
    console.log(`   Com phoneNormalized: ${usersWithPhoneNormalized}`);
    console.log(`   Diferença: ${usersWithPhone - usersWithPhoneNormalized}`);
    
    if (usersWithPhone === usersWithPhoneNormalized) {
      console.log('\n✅ [FIX] SUCESSO! Todos os usuários com phone têm phoneNormalized correto\n');
    } else {
      console.log('\n⚠️  [FIX] ATENÇÃO: Ainda há inconsistências. Execute o script novamente.\n');
    }
    
    console.log('🏁 [FIX] Correção concluída!');
    
  } catch (error) {
    console.error('\n❌ [FIX] Erro ao corrigir dados:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 [FIX] Conexão com MongoDB fechada');
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  fixPhoneNormalizedData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { fixPhoneNormalizedData };

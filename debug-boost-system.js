/**
 * Script para debugar o sistema de incremento de boosts
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function debugBoostSystem() {
  try {
    console.log('🔄 Conectando ao MongoDB (ChatApi)...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');
    console.log('📊 Database:', mongoose.connection.db.databaseName);
    
    // 1. Verificar agreements completados
    console.log('\n🔍 VERIFICANDO AGREEMENTS COMPLETADOS...\n');
    
    const Agreement = require('./src/models/Agreement');
    const completedAgreements = await Agreement.find({ status: 'completed' })
      .sort({ completedAt: -1 })
      .limit(5);
    
    console.log(`📊 Total de agreements completados: ${completedAgreements.length}\n`);
    
    if (completedAgreements.length > 0) {
      console.log('✅ Últimos agreements completados:\n');
      
      for (const ag of completedAgreements) {
        console.log(`   Agreement ID: ${ag.agreementId}`);
        console.log(`   Booster ID: ${ag.parties.booster.userid}`);
        console.log(`   Booster Name: ${ag.parties.booster.name}`);
        console.log(`   Status: ${ag.status}`);
        console.log(`   Completado em: ${ag.completedAt}`);
        
        // Verificar se o booster existe e tem boosts incrementados
        const User = require('./src/models/User');
        const booster = await User.findById(ag.parties.booster.userid);
        
        if (booster) {
          console.log(`   ✅ Usuário encontrado: ${booster.name}`);
          console.log(`      totalBoosts: ${booster.totalBoosts}`);
          console.log(`      completedBoosts: ${booster.completedBoosts}`);
          console.log(`      rating: ${booster.rating}`);
        } else {
          console.log(`   ❌ Usuário NÃO encontrado no banco!`);
        }
        console.log('');
      }
    } else {
      console.log('⚠️  Nenhum agreement completado encontrado!\n');
    }

    // 2. Verificar se há usuários com boosts
    console.log('\n🔍 VERIFICANDO USUÁRIOS COM BOOSTS...\n');
    
    const User = require('./src/models/User');
    const usersWithBoosts = await User.find({
      $or: [
        { totalBoosts: { $gt: 0 } },
        { completedBoosts: { $gt: 0 } }
      ]
    });
    
    if (usersWithBoosts.length > 0) {
      console.log(`✅ Encontrados ${usersWithBoosts.length} usuários com boosts:\n`);
      usersWithBoosts.forEach(u => {
        console.log(`   - ${u.name} (ID: ${u._id})`);
        console.log(`     totalBoosts: ${u.totalBoosts}`);
        console.log(`     completedBoosts: ${u.completedBoosts}`);
        console.log('');
      });
    } else {
      console.log('⚠️  Nenhum usuário com boosts encontrado!\n');
      console.log('💡 Isso significa que o incremento NÃO está acontecendo.\n');
    }

    // 3. Verificar modelo User
    console.log('\n🔍 VERIFICANDO SCHEMA DO USER...\n');
    
    const userSchema = User.schema.obj;
    console.log('   Campos relacionados a boosts:');
    console.log(`   - totalBoosts: ${userSchema.totalBoosts ? 'EXISTE' : 'NÃO EXISTE'}`);
    console.log(`   - completedBoosts: ${userSchema.completedBoosts ? 'EXISTE' : 'NÃO EXISTE'}`);
    console.log(`   - rating: ${userSchema.rating ? JSON.stringify(userSchema.rating) : 'NÃO EXISTE'}`);
    
    console.log('\n✅ Debug concluído!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Erro:', error);
    process.exit(1);
  }
}

debugBoostSystem();

/**
 * Script para testar o incremento de boosts ao completar agreement
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function testAgreementIncrement() {
  try {
    console.log('🔄 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');
    console.log('📊 Database:', mongoose.connection.db.databaseName);
    
    const Agreement = require('./src/models/Agreement');
    const User = require('./src/models/User');
    
    // Buscar o agreement mais recente completado
    console.log('\n🔍 Buscando último agreement completado...\n');
    
    const latestAgreement = await Agreement.findOne({ status: 'completed' })
      .sort({ completedAt: -1 });
    
    if (!latestAgreement) {
      console.log('❌ Nenhum agreement completado encontrado!');
      process.exit(1);
    }
    
    console.log(`✅ Agreement encontrado: ${latestAgreement.agreementId}`);
    console.log(`   Booster ID: ${latestAgreement.parties.booster.userid}`);
    console.log(`   Booster Name: ${latestAgreement.parties.booster.name}`);
    console.log(`   Completado em: ${latestAgreement.completedAt}`);
    console.log('');
    
    const boosterId = latestAgreement.parties.booster.userid;
    
    // Verificar o booster antes
    console.log('🔍 Verificando booster ANTES do teste:\n');
    const boosterBefore = await User.findById(boosterId);
    
    if (!boosterBefore) {
      console.log(`❌ Booster não encontrado com ID: ${boosterId}`);
      process.exit(1);
    }
    
    console.log(`   - Nome: ${boosterBefore.name}`);
    console.log(`   - totalBoosts: ${boosterBefore.totalBoosts}`);
    console.log(`   - completedBoosts: ${boosterBefore.completedBoosts}`);
    console.log('');
    
    // Simular exatamente o que o código faz
    console.log('🧪 SIMULANDO O CÓDIGO DE INCREMENTO...\n');
    
    console.log(`🔍 Tentando incrementar boosts para booster: ${boosterId}`);
    console.log(`🔍 Tipo do boosterId: ${typeof boosterId}`);
    console.log('');
    
    try {
      const updateResult = await User.findByIdAndUpdate(
        boosterId,
        {
          $inc: { 
            completedBoosts: 1,
            totalBoosts: 1
          }
        },
        { new: true, runValidators: false }
      );
      
      if (updateResult) {
        console.log(`✅ Incremento bem-sucedido!`);
        console.log(`   - User: ${updateResult.name}`);
        console.log(`   - New totalBoosts: ${updateResult.totalBoosts}`);
        console.log(`   - New completedBoosts: ${updateResult.completedBoosts}`);
      } else {
        console.log(`❌ findByIdAndUpdate retornou null!`);
        console.log(`   Isso significa que o ID não foi encontrado.`);
        console.log(`   ID usado: ${boosterId}`);
        console.log(`   Tipo: ${typeof boosterId}`);
      }
    } catch (error) {
      console.error(`❌ Erro ao incrementar:`);
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    }
    
    console.log('\n🔍 Verificando booster DEPOIS do teste:\n');
    const boosterAfter = await User.findById(boosterId);
    
    if (boosterAfter) {
      console.log(`   - Nome: ${boosterAfter.name}`);
      console.log(`   - totalBoosts: ${boosterAfter.totalBoosts}`);
      console.log(`   - completedBoosts: ${boosterAfter.completedBoosts}`);
    }
    
    // Comparar
    console.log('\n📊 COMPARAÇÃO:\n');
    console.log(`   Antes:  totalBoosts=${boosterBefore.totalBoosts}, completedBoosts=${boosterBefore.completedBoosts}`);
    console.log(`   Depois: totalBoosts=${boosterAfter.totalBoosts}, completedBoosts=${boosterAfter.completedBoosts}`);
    
    if (boosterAfter.totalBoosts > boosterBefore.totalBoosts) {
      console.log('\n✅ SUCESSO: O incremento funcionou!');
      console.log('💡 O problema deve estar no deploy ou no fluxo de execução em produção.\n');
      
      // Reverter
      console.log('🔄 Revertendo o incremento de teste...');
      await User.findByIdAndUpdate(
        boosterId,
        {
          $inc: { 
            completedBoosts: -1,
            totalBoosts: -1
          }
        }
      );
      console.log('✅ Revertido!');
    } else {
      console.log('\n❌ FALHA: O incremento NÃO funcionou!');
      console.log('💡 Há um problema no código ou no modelo.\n');
    }
    
    console.log('\n✅ Teste concluído!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Erro:', error);
    process.exit(1);
  }
}

testAgreementIncrement();

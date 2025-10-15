require('dotenv').config();
const mongoose = require('mongoose');

async function descobrirMediadorViaMediator() {
  try {
    console.log('🔍 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado!\n');

    const Mediator = require('./src/models/Mediator');
    const WalletLedger = require('./src/models/WalletLedger');
    const User = require('./src/models/User');

    // 1. Buscar eventos de fee no Mediator
    console.log('📊 Buscando eventos de FEE na collection Mediator...\n');
    
    const feeEvents = await Mediator.find({ 
      eventType: 'fee'
    }).sort({ occurredAt: -1 }).limit(10);

    if (feeEvents.length === 0) {
      console.log('❌ Nenhum evento de fee encontrado na collection Mediator!');
      console.log('⚠️ O sistema ainda não processou nenhuma taxa.\n');
      
      // Verificar se há algum registro no Mediator
      const anyEvent = await Mediator.findOne({}).sort({ occurredAt: -1 });
      if (anyEvent) {
        console.log('📋 Último evento encontrado:');
        console.log('  Tipo:', anyEvent.eventType);
        console.log('  Source:', anyEvent.source);
        console.log('  Data:', anyEvent.occurredAt);
        console.log('  Valor:', `R$ ${anyEvent.amount.toFixed(2)}`);
        console.log('');
      }
      return;
    }

    console.log(`✅ Encontrados ${feeEvents.length} eventos de fee\n`);

    // 2. Analisar eventos de fee
    console.log('💰 EVENTOS DE FEE ENCONTRADOS:\n');
    
    const walletLedgerIds = [];
    
    for (const event of feeEvents.slice(0, 5)) {
      console.log(`📌 ${event.occurredAt.toISOString()}`);
      console.log(`   Source: ${event.source}`);
      console.log(`   Valor: R$ ${event.amount.toFixed(2)}`);
      console.log(`   Operation ID: ${event.operationId}`);
      
      if (event.reference?.walletLedgerId) {
        console.log(`   WalletLedger ID: ${event.reference.walletLedgerId}`);
        walletLedgerIds.push(event.reference.walletLedgerId);
      } else {
        console.log(`   ⚠️ Sem walletLedgerId`);
      }
      console.log('');
    }

    // 3. Buscar WalletLedgers relacionados
    if (walletLedgerIds.length > 0) {
      console.log('🔍 Buscando WalletLedgers relacionados...\n');
      
      const ledgers = await WalletLedger.find({
        _id: { $in: walletLedgerIds }
      });

      if (ledgers.length > 0) {
        // Agrupar por userId
        const userIds = [...new Set(ledgers.map(l => l.userId.toString()))];
        
        console.log(`✅ Encontrados ${ledgers.length} WalletLedgers para ${userIds.length} usuário(s)\n`);

        for (const userId of userIds) {
          const userLedgers = ledgers.filter(l => l.userId.toString() === userId);
          const totalAmount = userLedgers.reduce((sum, l) => sum + l.amount, 0);

          console.log(`👤 USUÁRIO ID: ${userId}`);
          console.log(`   Taxas recebidas: ${userLedgers.length}`);
          console.log(`   Valor total: R$ ${totalAmount.toFixed(2)}`);

          // Buscar informações do usuário
          const user = await User.findById(userId);
          if (user) {
            console.log(`   Email: ${user.email}`);
            console.log(`   Nome: ${user.name}`);
            console.log(`   Saldo atual: R$ ${(user.walletBalance || 0).toFixed(2)}`);
            console.log(`   Role: ${user.role || 'N/A'}`);
            
            console.log('');
            console.log('   ✅ CONFIGURAÇÃO PARA .env:');
            console.log(`   MEDIATOR_EMAIL=${user.email}`);
            console.log('');
            
            // Este é o mediador! Verificar se já tem taxas de boosting
            const boostingFees = await WalletLedger.find({
              userId: user._id,
              reason: 'boosting_fee'
            });

            console.log(`   🎮 Taxas de boosting: ${boostingFees.length}`);
            if (boostingFees.length > 0) {
              console.log('      (Boosting já está funcionando para este usuário!)');
            } else {
              console.log('      (Boosting ainda não foi testado)');
            }
          } else {
            console.log(`   ❌ Usuário não encontrado no banco!`);
          }
          console.log('');
        }
      } else {
        console.log('⚠️ Nenhum WalletLedger encontrado com os IDs referenciados\n');
      }
    }

    // 4. Estatísticas gerais
    console.log('📊 ESTATÍSTICAS GERAIS:\n');
    
    const totalFees = await Mediator.countDocuments({ eventType: 'fee' });
    const totalReleases = await Mediator.countDocuments({ eventType: 'release' });
    
    console.log(`  Total de eventos 'fee': ${totalFees}`);
    console.log(`  Total de eventos 'release': ${totalReleases}`);
    console.log('');

    // 5. Verificar configuração atual
    console.log('⚙️ CONFIGURAÇÃO ATUAL (.env):');
    console.log(`  MEDIATOR_EMAIL: ${process.env.MEDIATOR_EMAIL || '❌ NÃO CONFIGURADO'}`);
    console.log('');

  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Verificação concluída!');
    process.exit(0);
  }
}

descobrirMediadorViaMediator();

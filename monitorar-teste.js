require('dotenv').config();
const mongoose = require('mongoose');

let initialState = null;

async function capturarEstadoInicial() {
  try {
    console.log('🔍 Capturando estado INICIAL do sistema...\n');
    await mongoose.connect(process.env.MONGODB_URI);

    const User = require('./src/models/User');
    const WalletLedger = require('./src/models/WalletLedger');
    const Mediator = require('./src/models/Mediator');

    const mediatorEmail = process.env.MEDIATOR_EMAIL || 'klouts69@gmail.com';
    const mediatorUser = await User.findOne({ email: mediatorEmail });

    if (!mediatorUser) {
      console.log('❌ Mediador não encontrado!');
      console.log(`   Email buscado: ${mediatorEmail}`);
      process.exit(1);
    }

    const boostingFees = await WalletLedger.countDocuments({
      userId: mediatorUser._id,
      reason: 'boosting_fee'
    });

    const mediatorDocs = await Mediator.countDocuments({});

    initialState = {
      mediatorId: mediatorUser._id.toString(),
      mediatorEmail: mediatorUser.email,
      mediatorName: mediatorUser.name,
      saldoInicial: mediatorUser.walletBalance || 0,
      boostingFeesInicial: boostingFees,
      mediatorDocsInicial: mediatorDocs
    };

    console.log('📊 ESTADO INICIAL:');
    console.log('================================================================================');
    console.log('');
    console.log('👤 MEDIADOR:');
    console.log(`   ID: ${initialState.mediatorId}`);
    console.log(`   Email: ${initialState.mediatorEmail}`);
    console.log(`   Nome: ${initialState.mediatorName}`);
    console.log(`   Saldo: R$ ${initialState.saldoInicial.toFixed(2)}`);
    console.log('');
    console.log('📊 ESTATÍSTICAS:');
    console.log(`   WalletLedgers (boosting_fee): ${initialState.boostingFeesInicial}`);
    console.log(`   Documentos na collection Mediator: ${initialState.mediatorDocsInicial}`);
    console.log('');
    console.log('================================================================================');
    console.log('');
    console.log('⏳ AGUARDANDO CONFIRMAÇÃO DE ENTREGA...');
    console.log('   (Confirme a entrega no painel agora)');
    console.log('');
    console.log('   Pressione CTRL+C quando terminar o teste');
    console.log('');

    // Salvar estado em arquivo
    const fs = require('fs');
    fs.writeFileSync('./.teste-state.json', JSON.stringify(initialState, null, 2));

    return initialState;

  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

async function verificarEstadoFinal() {
  try {
    console.log('\n🔍 Capturando estado FINAL do sistema...\n');

    const User = require('./src/models/User');
    const WalletLedger = require('./src/models/WalletLedger');
    const Mediator = require('./src/models/Mediator');

    const mediatorUser = await User.findById(initialState.mediatorId);

    if (!mediatorUser) {
      console.log('❌ Mediador não encontrado!');
      return;
    }

    const boostingFees = await WalletLedger.countDocuments({
      userId: mediatorUser._id,
      reason: 'boosting_fee'
    });

    const mediatorDocs = await Mediator.countDocuments({});

    const finalState = {
      saldoFinal: mediatorUser.walletBalance || 0,
      boostingFeesFinal: boostingFees,
      mediatorDocsFinal: mediatorDocs
    };

    console.log('📊 ESTADO FINAL:');
    console.log('================================================================================');
    console.log('');
    console.log('👤 MEDIADOR:');
    console.log(`   Saldo: R$ ${finalState.saldoFinal.toFixed(2)}`);
    console.log('');
    console.log('📊 ESTATÍSTICAS:');
    console.log(`   WalletLedgers (boosting_fee): ${finalState.boostingFeesFinal}`);
    console.log(`   Documentos na collection Mediator: ${finalState.mediatorDocsFinal}`);
    console.log('');
    console.log('================================================================================');
    console.log('');

    // Comparação
    const saldoDiff = finalState.saldoFinal - initialState.saldoInicial;
    const feesDiff = finalState.boostingFeesFinal - initialState.boostingFeesInicial;
    const docsDiff = finalState.mediatorDocsFinal - initialState.mediatorDocsInicial;

    console.log('📈 COMPARAÇÃO (Antes → Depois):');
    console.log('================================================================================');
    console.log('');
    console.log(`   Saldo do mediador:`);
    console.log(`      Antes:  R$ ${initialState.saldoInicial.toFixed(2)}`);
    console.log(`      Depois: R$ ${finalState.saldoFinal.toFixed(2)}`);
    console.log(`      ${saldoDiff > 0 ? '✅' : '❌'} Diferença: ${saldoDiff >= 0 ? '+' : ''}R$ ${saldoDiff.toFixed(2)} ${saldoDiff === 15 ? '(CORRETO!)' : saldoDiff > 0 ? '(Valor diferente do esperado)' : '(NÃO MUDOU!)'}`);
    console.log('');
    console.log(`   WalletLedgers (boosting_fee):`);
    console.log(`      Antes:  ${initialState.boostingFeesInicial}`);
    console.log(`      Depois: ${finalState.boostingFeesFinal}`);
    console.log(`      ${feesDiff > 0 ? '✅' : '❌'} Diferença: ${feesDiff >= 0 ? '+' : ''}${feesDiff} ${feesDiff > 0 ? '(OK!)' : '(NÃO MUDOU!)'}`);
    console.log('');
    console.log(`   Collection Mediator:`);
    console.log(`      Antes:  ${initialState.mediatorDocsInicial}`);
    console.log(`      Depois: ${finalState.mediatorDocsFinal}`);
    console.log(`      ${docsDiff >= 2 ? '✅' : '❌'} Diferença: ${docsDiff >= 0 ? '+' : ''}${docsDiff} ${docsDiff >= 2 ? '(OK! release + fee)' : docsDiff > 0 ? '(Incompleto)' : '(NÃO MUDOU!)'}`);
    console.log('');
    console.log('================================================================================');
    console.log('');

    // Resultado final
    const passou = saldoDiff === 15 && feesDiff > 0 && docsDiff >= 2;

    if (passou) {
      console.log('🎉 TESTE PASSOU! ✅');
      console.log('');
      console.log('   ✅ Saldo do mediador aumentou R$ 15,00');
      console.log('   ✅ WalletLedger criado com boosting_fee');
      console.log('   ✅ Collection Mediator registrou os eventos');
      console.log('');
      console.log('   🚀 SISTEMA FUNCIONANDO PERFEITAMENTE!');
      console.log('');
      console.log('   📋 Próximos passos:');
      console.log('      1. Testar também o marketplace');
      console.log('      2. Verificar painel administrativo');
      console.log('      3. Monitorar próximas confirmações');
    } else {
      console.log('❌ TESTE FALHOU!');
      console.log('');
      if (saldoDiff !== 15) {
        console.log(`   ❌ Saldo do mediador ${saldoDiff === 0 ? 'NÃO mudou' : 'mudou valor incorreto'}`);
        console.log(`      Esperado: +R$ 15,00`);
        console.log(`      Recebido: ${saldoDiff >= 0 ? '+' : ''}R$ ${saldoDiff.toFixed(2)}`);
      }
      if (feesDiff === 0) {
        console.log('   ❌ WalletLedger (boosting_fee) NÃO foi criado');
      }
      if (docsDiff < 2) {
        console.log('   ❌ Collection Mediator não registrou todos os eventos');
        console.log(`      Esperado: +2 (release + fee)`);
        console.log(`      Recebido: +${docsDiff}`);
      }
      console.log('');
      console.log('   🔍 Verificar logs do pm2:');
      console.log('      pm2 logs ZenithChat --lines 100');
    }

    console.log('');
    console.log('================================================================================');
    console.log('✅ Monitoramento concluído!\n');

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

// Executar
(async () => {
  await capturarEstadoInicial();

  // Aguardar 5 minutos antes de verificar estado final
  // (ou usuário pode pressionar CTRL+C e rodar novamente)
  setTimeout(async () => {
    await verificarEstadoFinal();
  }, 300000); // 5 minutos

  // Permitir verificação manual
  process.on('SIGINT', async () => {
    console.log('\n\n⏸️  Interrompido pelo usuário. Verificando estado final...\n');
    await verificarEstadoFinal();
  });
})();

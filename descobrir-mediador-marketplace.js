require('dotenv').config();
const mongoose = require('mongoose');

async function descobrirMediadorMarketplace() {
  try {
    console.log('🔍 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado!\n');

    const WalletLedger = require('./src/models/WalletLedger');
    const User = require('./src/models/User');

    // 1. Buscar taxas do marketplace (purchase_fee)
    console.log('📊 Buscando taxas do marketplace (purchase_fee)...\n');
    
    const purchaseFees = await WalletLedger.find({ 
      reason: 'purchase_fee',
      direction: 'credit'
    }).sort({ createdAt: -1 }).limit(5);

    if (purchaseFees.length === 0) {
      console.log('❌ Nenhuma taxa de marketplace encontrada!');
      console.log('⚠️ O marketplace ainda não processou nenhuma venda com taxa.');
      return;
    }

    console.log(`✅ Encontradas ${purchaseFees.length} taxas de marketplace\n`);

    // 2. Pegar o userId da taxa mais recente
    const latestFee = purchaseFees[0];
    const mediatorUserId = latestFee.userId;

    console.log('💰 TAXA MAIS RECENTE:');
    console.log('  Data:', latestFee.createdAt.toISOString());
    console.log('  Valor:', `R$ ${latestFee.amount.toFixed(2)}`);
    console.log('  User ID:', mediatorUserId.toString());
    console.log('  Operation ID:', latestFee.operationId);
    console.log('');

    // 3. Buscar informações do usuário mediador
    console.log('👤 BUSCANDO USUÁRIO MEDIADOR...\n');
    
    const mediatorUser = await User.findById(mediatorUserId);

    if (!mediatorUser) {
      console.log('❌ Usuário não encontrado!');
      return;
    }

    console.log('✅ USUÁRIO MEDIADOR ENCONTRADO:');
    console.log('  ID:', mediatorUser._id.toString());
    console.log('  Email:', mediatorUser.email);
    console.log('  Nome:', mediatorUser.name);
    console.log('  Username:', mediatorUser.username || 'N/A');
    console.log('  Role:', mediatorUser.role || 'N/A');
    console.log('  Saldo atual:', `R$ ${(mediatorUser.walletBalance || 0).toFixed(2)}`);
    console.log('  Ativo:', mediatorUser.isActive || false);
    console.log('');

    // 4. Contar total de taxas recebidas
    const totalFees = await WalletLedger.countDocuments({
      userId: mediatorUserId,
      reason: 'purchase_fee'
    });

    const sumResult = await WalletLedger.aggregate([
      {
        $match: {
          userId: mediatorUserId,
          reason: 'purchase_fee'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    const totalAmount = sumResult.length > 0 ? sumResult[0].total : 0;

    console.log('📊 ESTATÍSTICAS:');
    console.log('  Total de taxas recebidas:', totalFees);
    console.log('  Valor total acumulado:', `R$ ${totalAmount.toFixed(2)}`);
    console.log('');

    // 5. Verificar configuração atual do .env
    console.log('⚙️ CONFIGURAÇÃO ATUAL (.env):');
    console.log('  MEDIATOR_USER_ID:', process.env.MEDIATOR_USER_ID || '❌ NÃO CONFIGURADO');
    console.log('  MEDIATOR_EMAIL:', process.env.MEDIATOR_EMAIL || '❌ NÃO CONFIGURADO');
    console.log('');

    // 6. Sugerir configuração
    console.log('✅ SOLUÇÃO PARA BOOSTING:\n');
    console.log('Adicione no arquivo .env:');
    console.log('');
    console.log(`MEDIATOR_EMAIL=${mediatorUser.email}`);
    console.log('');
    console.log('OU (se preferir usar ID):');
    console.log('');
    console.log(`MEDIATOR_USER_ID=${mediatorUser._id.toString()}`);
    console.log(`MEDIATOR_EMAIL=${mediatorUser.email}`);
    console.log('');
    console.log('🔧 Depois:');
    console.log('  1. Atualizar .env com o email acima');
    console.log('  2. Reiniciar Chat API: pm2 restart ZenithChat');
    console.log('  3. Confirmar entrega de boosting');
    console.log('  4. Verificar se taxa foi creditada no mesmo usuário');
    console.log('');

    // 7. Verificar se há taxas de boosting para este usuário
    const boostingFees = await WalletLedger.find({
      userId: mediatorUserId,
      reason: 'boosting_fee'
    }).sort({ createdAt: -1 }).limit(3);

    console.log('🎮 TAXAS DE BOOSTING PARA ESTE USUÁRIO:');
    if (boostingFees.length > 0) {
      console.log(`  ✅ Encontradas ${boostingFees.length} taxas`);
      boostingFees.forEach(f => {
        console.log(`    - ${f.createdAt.toISOString()} | R$ ${f.amount.toFixed(2)}`);
      });
    } else {
      console.log('  ⚠️ Nenhuma taxa de boosting encontrada (ainda não foi testado)');
    }
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

descobrirMediadorMarketplace();

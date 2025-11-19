/**
 * Script para verificar BoostingOrders no banco de dados
 * Diagnostica se existem pedidos de boosting e suas configurações
 */

require('dotenv').config();
const mongoose = require('mongoose');
const BoostingOrder = require('../src/models/BoostingOrder');
const Agreement = require('../src/models/Agreement');

async function checkBoostingOrders() {
  try {
    console.log('🔍 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    // Verificar total de BoostingOrders
    const totalBoostingOrders = await BoostingOrder.countDocuments();
    console.log(`📊 Total de BoostingOrders no banco: ${totalBoostingOrders}\n`);

    if (totalBoostingOrders === 0) {
      console.log('⚠️  Nenhum BoostingOrder encontrado no banco!');
      console.log('   Verificando Agreements...\n');

      // Verificar Agreements
      const totalAgreements = await Agreement.countDocuments();
      console.log(`📊 Total de Agreements no banco: ${totalAgreements}\n`);

      if (totalAgreements > 0) {
        console.log('✅ Agreements encontrados. Vamos criar BoostingOrders a partir deles...\n');
        
        const agreements = await Agreement.find({ status: { $in: ['active', 'completed', 'cancelled'] } })
          .limit(10)
          .lean();

        console.log(`📝 Encontrados ${agreements.length} Agreements ativos/completos/cancelados`);
        console.log('   Criando BoostingOrders...\n');

        let created = 0;
        for (const agreement of agreements) {
          try {
            const bo = await BoostingOrder.createFromAgreement(agreement);
            console.log(`   ✅ BoostingOrder criado: ${bo.orderNumber}`);
            created++;
          } catch (err) {
            console.log(`   ❌ Erro ao criar BoostingOrder: ${err.message}`);
          }
        }

        console.log(`\n✅ ${created} BoostingOrders criados com sucesso!`);
      } else {
        console.log('⚠️  Nenhum Agreement encontrado no banco.');
      }
    } else {
      // Listar alguns BoostingOrders
      console.log('📋 Últimos 10 BoostingOrders:\n');
      const orders = await BoostingOrder.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('orderNumber clientId boosterId status price createdAt serviceSnapshot')
        .lean();

      orders.forEach((order, index) => {
        console.log(`${index + 1}. ${order.orderNumber}`);
        console.log(`   Status: ${order.status}`);
        console.log(`   Preço: R$ ${order.price}`);
        console.log(`   Game: ${order.serviceSnapshot?.game || 'N/A'}`);
        console.log(`   Cliente: ${order.clientId}`);
        console.log(`   Booster: ${order.boosterId}`);
        console.log(`   Criado em: ${order.createdAt}\n`);
      });

      // Verificar distribuição por status
      console.log('📊 Distribuição por Status:\n');
      const statusCounts = await BoostingOrder.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);

      statusCounts.forEach(({ _id, count }) => {
        console.log(`   ${_id}: ${count}`);
      });
      console.log('');

      // Verificar por usuário
      console.log('📊 Top 5 Clientes:\n');
      const topClients = await BoostingOrder.aggregate([
        { $group: { _id: '$clientId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]);

      topClients.forEach(({ _id, count }, index) => {
        console.log(`   ${index + 1}. Cliente ${_id}: ${count} pedidos`);
      });
      console.log('');

      console.log('📊 Top 5 Boosters:\n');
      const topBoosters = await BoostingOrder.aggregate([
        { $group: { _id: '$boosterId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]);

      topBoosters.forEach(({ _id, count }, index) => {
        console.log(`   ${index + 1}. Booster ${_id}: ${count} pedidos`);
      });
      console.log('');
    }

    console.log('✅ Verificação completa!');
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado do MongoDB');
  }
}

checkBoostingOrders();

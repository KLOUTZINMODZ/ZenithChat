/**
 * Script de migração para criar BoostingOrders a partir de Agreements existentes
 * Garante que todos os pedidos de boosting apareçam na listagem de compras/vendas
 */

require('dotenv').config();
const mongoose = require('mongoose');
const BoostingOrder = require('../src/models/BoostingOrder');
const Agreement = require('../src/models/Agreement');

async function migrateAgreementsToBoostingOrders() {
  try {
    console.log('🚀 Iniciando migração de Agreements para BoostingOrders...\n');
    
    // Conectar ao MongoDB
    console.log('🔗 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    // Contar registros existentes
    const existingBoostingOrders = await BoostingOrder.countDocuments();
    console.log(`📊 BoostingOrders existentes: ${existingBoostingOrders}`);

    // Buscar todos os Agreements (ativos, completos e cancelados)
    const agreements = await Agreement.find({
      status: { $in: ['pending', 'active', 'completed', 'cancelled'] }
    }).sort({ createdAt: -1 });

    console.log(`📊 Agreements encontrados: ${agreements.length}\n`);

    if (agreements.length === 0) {
      console.log('⚠️  Nenhum Agreement encontrado para migrar.');
      return;
    }

    console.log('🔄 Processando Agreements...\n');

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const agreement of agreements) {
      try {
        // Verificar se já existe BoostingOrder para este Agreement
        const existing = await BoostingOrder.findOne({ agreementId: agreement._id });
        
        if (existing) {
          // Atualizar se necessário
          await existing.syncFromAgreement(agreement);
          skipped++;
          process.stdout.write(`⏭️  Agreement ${agreement.agreementId || agreement._id} já possui BoostingOrder\r`);
        } else {
          // Criar novo BoostingOrder
          const boostingOrder = await BoostingOrder.createFromAgreement(agreement);
          created++;
          console.log(`✅ BoostingOrder criado: ${boostingOrder.orderNumber} (Agreement: ${agreement.agreementId || agreement._id})`);
        }
      } catch (err) {
        errors++;
        console.error(`❌ Erro ao processar Agreement ${agreement.agreementId || agreement._id}:`, err.message);
      }
    }

    console.log('\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('📊 RESUMO DA MIGRAÇÃO');
    console.log('═══════════════════════════════════════════════════');
    console.log(`✅ BoostingOrders criados: ${created}`);
    console.log(`⏭️  BoostingOrders já existentes: ${skipped}`);
    console.log(`❌ Erros: ${errors}`);
    console.log(`📊 Total processado: ${agreements.length}`);
    console.log('═══════════════════════════════════════════════════\n');

    // Verificar resultado final
    const finalCount = await BoostingOrder.countDocuments();
    console.log(`📊 Total de BoostingOrders no banco após migração: ${finalCount}\n`);

    // Mostrar distribuição por status
    console.log('📊 Distribuição por Status:');
    const statusDistribution = await BoostingOrder.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    statusDistribution.forEach(({ _id, count }) => {
      console.log(`   ${_id}: ${count}`);
    });

    console.log('\n✅ Migração concluída com sucesso!');
    console.log('   Os pedidos de boosting agora devem aparecer em "Minhas Compras" e "Minhas Vendas".\n');

  } catch (error) {
    console.error('❌ Erro fatal na migração:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Desconectado do MongoDB\n');
  }
}

// Executar migração
migrateAgreementsToBoostingOrders();

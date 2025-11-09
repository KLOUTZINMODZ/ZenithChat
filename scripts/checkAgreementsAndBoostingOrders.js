/**
 * Script rápido para verificar Agreements e BoostingOrders no banco
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Agreement = require('../src/models/Agreement');
const BoostingOrder = require('../src/models/BoostingOrder');

async function check() {
  try {
    console.log('🔗 Conectando...');
    await mongoose.connect(process.env.MONGODB_URI);
    
    const totalAgreements = await Agreement.countDocuments();
    const totalBoostingOrders = await BoostingOrder.countDocuments();
    
    console.log('\n📊 SITUAÇÃO ATUAL:');
    console.log(`   Agreements no banco: ${totalAgreements}`);
    console.log(`   BoostingOrders no banco: ${totalBoostingOrders}\n`);
    
    if (totalAgreements > 0 && totalBoostingOrders === 0) {
      console.log('⚠️  PROBLEMA DETECTADO!');
      console.log('   Existem Agreements mas nenhum BoostingOrder.');
      console.log('   Execute: npm run boosting:migrate\n');
    } else if (totalAgreements === 0) {
      console.log('ℹ️  Não há Agreements no banco.');
      console.log('   Pedidos de boosting aparecerão quando houver Agreements.\n');
    } else {
      console.log('✅ Tudo certo! BoostingOrders existem.\n');
    }
    
    // Mostrar alguns Agreements
    if (totalAgreements > 0) {
      console.log('📋 Últimos 5 Agreements:');
      const agreements = await Agreement.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('agreementId status parties createdAt')
        .lean();
      
      agreements.forEach((a, i) => {
        console.log(`   ${i + 1}. ${a.agreementId || a._id}`);
        console.log(`      Status: ${a.status}`);
        console.log(`      Cliente: ${a.parties?.client?.userid || 'N/A'}`);
        console.log(`      Booster: ${a.parties?.booster?.userid || 'N/A'}`);
        console.log(`      Criado: ${a.createdAt}\n`);
      });
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

check();

/**
 * Script para monitorar as 4 collections em tempo real
 * Uso: node scripts/monitor-collections.js <conversationId> <intervalo-em-segundos>
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Importar modelos
const Conversation = require('../src/models/Conversation');
const Agreement = require('../src/models/Agreement');
const AcceptedProposal = require('../src/models/AcceptedProposal');
const BoostingRequest = require('../src/models/BoostingRequest');
const BoostingOrder = require('../src/models/BoostingOrder');

const conversationId = process.argv[2];
const interval = parseInt(process.argv[3]) || 2; // 2 segundos por padrão

if (!conversationId) {
  console.error('❌ Uso: node scripts/monitor-collections.js <conversationId> [intervalo-em-segundos]');
  process.exit(1);
}

let checkCount = 0;

async function checkCollections() {
  checkCount++;
  console.clear();
  console.log(`\n📊 MONITORAMENTO DE COLLECTIONS - Check #${checkCount}`);
  console.log(`🔍 Conversation ID: ${conversationId}`);
  console.log(`⏱️  Intervalo: ${interval}s\n`);

  try {
    // 1️⃣ CONVERSATION
    const conversation = await Conversation.findById(conversationId);
    const convStatus = conversation ? {
      isActive: conversation.isActive,
      boostingStatus: conversation.boostingStatus,
      status: conversation.status,
      isFinalized: conversation.isFinalized,
      updatedAt: conversation.updatedAt
    } : null;

    // 2️⃣ AGREEMENT
    const agreement = await Agreement.findOne({ conversationId }).sort({ createdAt: -1 });
    const agrStatus = agreement ? {
      status: agreement.status,
      cancelledAt: agreement.cancelledAt,
      updatedAt: agreement.updatedAt
    } : null;

    // 3️⃣ ACCEPTEDPROPOSAL
    const acceptedProposals = await AcceptedProposal.find({ conversationId });
    const apStatus = acceptedProposals.map(ap => ({
      _id: ap._id.toString(),
      status: ap.status,
      cancelledAt: ap.cancelledAt,
      updatedAt: ap.updatedAt
    }));

    // 4️⃣ BOOSTING_REQUESTS
    let boostingId = conversation?.metadata?.get?.('boostingId') || 
                     conversation?.proposal || 
                     conversation?.marketplaceItem;
    
    if (!boostingId && agreement) {
      boostingId = agreement.boostingId;
    }

    const boostingRequest = boostingId ? await BoostingRequest.findById(boostingId) : null;
    const brStatus = boostingRequest ? {
      status: boostingRequest.status,
      cancelledAt: boostingRequest.cancelledAt,
      updatedAt: boostingRequest.updatedAt
    } : null;

    // 5️⃣ BOOSTINGORDER
    const boostingOrder = await BoostingOrder.findOne({ conversationId });
    const boStatus = boostingOrder ? {
      status: boostingOrder.status,
      cancelledAt: boostingOrder.cancelledAt,
      updatedAt: boostingOrder.updatedAt
    } : null;

    // EXIBIR RESULTADOS
    console.log('═══════════════════════════════════════════════════════════');
    console.log('1️⃣  CONVERSATION');
    console.log('═══════════════════════════════════════════════════════════');
    if (convStatus) {
      console.log(`isActive: ${convStatus.isActive} ${convStatus.isActive === false ? '✅' : '❌'}`);
      console.log(`boostingStatus: ${convStatus.boostingStatus} ${convStatus.boostingStatus === 'cancelled' ? '✅' : '❌'}`);
      console.log(`status: ${convStatus.status} ${convStatus.status === 'cancelled' ? '✅' : '❌'}`);
      console.log(`isFinalized: ${convStatus.isFinalized} ${convStatus.isFinalized === true ? '✅' : '❌'}`);
      console.log(`updatedAt: ${convStatus.updatedAt}`);
    } else {
      console.log('❌ Não encontrada');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('2️⃣  AGREEMENT');
    console.log('═══════════════════════════════════════════════════════════');
    if (agrStatus) {
      console.log(`status: ${agrStatus.status} ${agrStatus.status === 'cancelled' ? '✅' : '❌'}`);
      console.log(`cancelledAt: ${agrStatus.cancelledAt} ${agrStatus.cancelledAt ? '✅' : '❌'}`);
      console.log(`updatedAt: ${agrStatus.updatedAt}`);
    } else {
      console.log('❌ Não encontrado');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('3️⃣  ACCEPTEDPROPOSAL');
    console.log('═══════════════════════════════════════════════════════════');
    if (apStatus.length > 0) {
      console.log(`Encontrados: ${apStatus.length} registro(s)`);
      apStatus.forEach((ap, idx) => {
        console.log(`\n[${idx + 1}] status: ${ap.status} ${ap.status === 'cancelled' ? '✅' : '❌'}`);
        console.log(`    cancelledAt: ${ap.cancelledAt} ${ap.cancelledAt ? '✅' : '❌'}`);
        console.log(`    updatedAt: ${ap.updatedAt}`);
      });
    } else {
      console.log('❌ Nenhum encontrado');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('4️⃣  BOOSTING_REQUESTS');
    console.log('═══════════════════════════════════════════════════════════');
    if (brStatus) {
      console.log(`status: ${brStatus.status} ${brStatus.status === 'cancelled' ? '✅' : '❌'}`);
      console.log(`cancelledAt: ${brStatus.cancelledAt} ${brStatus.cancelledAt ? '✅' : '❌'}`);
      console.log(`updatedAt: ${brStatus.updatedAt}`);
    } else {
      console.log(`❌ Não encontrado (ID: ${boostingId})`);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('5️⃣  BOOSTINGORDER');
    console.log('═══════════════════════════════════════════════════════════');
    if (boStatus) {
      console.log(`status: ${boStatus.status} ${boStatus.status === 'cancelled' ? '✅' : '❌'}`);
      console.log(`cancelledAt: ${boStatus.cancelledAt} ${boStatus.cancelledAt ? '✅' : '❌'}`);
      console.log(`updatedAt: ${boStatus.updatedAt}`);
    } else {
      console.log('❌ Não encontrado');
    }

    // RESUMO
    const allCancelled = 
      convStatus?.isActive === false &&
      convStatus?.boostingStatus === 'cancelled' &&
      convStatus?.status === 'cancelled' &&
      convStatus?.isFinalized === true &&
      agrStatus?.status === 'cancelled' &&
      apStatus.every(ap => ap.status === 'cancelled') &&
      brStatus?.status === 'cancelled' &&
      boStatus?.status === 'cancelled';

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(allCancelled ? '✅ TUDO CANCELADO!' : '⏳ AGUARDANDO CANCELAMENTO...');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

// Conectar ao MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hacklote')
  .then(() => {
    console.log('✅ Conectado ao MongoDB');
    checkCollections();
    setInterval(checkCollections, interval * 1000);
  })
  .catch(error => {
    console.error('❌ Erro ao conectar ao MongoDB:', error.message);
    process.exit(1);
  });

// Permitir sair com Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Monitoramento finalizado');
  mongoose.connection.close();
  process.exit(0);
});

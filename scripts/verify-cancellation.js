/**
 * Script para verificar se todas as 4 collections estão sendo atualizadas corretamente
 * Uso: node scripts/verify-cancellation.js <conversationId>
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

if (!conversationId) {
  console.error('❌ Uso: node scripts/verify-cancellation.js <conversationId>');
  process.exit(1);
}

async function verifyAllCollections() {
  try {
    console.log('\n📊 VERIFICANDO TODAS AS 4 COLLECTIONS\n');
    console.log(`🔍 Conversation ID: ${conversationId}\n`);

    // 1️⃣ CONVERSATION
    console.log('═══════════════════════════════════════════════════════════');
    console.log('1️⃣  CONVERSATION');
    console.log('═══════════════════════════════════════════════════════════');
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      console.log(`✅ Encontrada`);
      console.log(`   isActive: ${conversation.isActive} ${conversation.isActive === false ? '✅' : '❌'}`);
      console.log(`   boostingStatus: ${conversation.boostingStatus} ${conversation.boostingStatus === 'cancelled' ? '✅' : '❌'}`);
      console.log(`   status: ${conversation.status} ${conversation.status === 'cancelled' ? '✅' : '❌'}`);
      console.log(`   isFinalized: ${conversation.isFinalized} ${conversation.isFinalized === true ? '✅' : '❌'}`);
      console.log(`   updatedAt: ${conversation.updatedAt}`);
    } else {
      console.log('❌ Não encontrada');
    }

    // 2️⃣ AGREEMENT
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('2️⃣  AGREEMENT');
    console.log('═══════════════════════════════════════════════════════════');
    const agreement = await Agreement.findOne({ conversationId }).sort({ createdAt: -1 });
    if (agreement) {
      console.log(`✅ Encontrado`);
      console.log(`   _id: ${agreement._id}`);
      console.log(`   status: ${agreement.status} ${agreement.status === 'cancelled' ? '✅' : '❌'}`);
      console.log(`   cancelledAt: ${agreement.cancelledAt} ${agreement.cancelledAt ? '✅' : '❌'}`);
      console.log(`   updatedAt: ${agreement.updatedAt}`);
    } else {
      console.log('❌ Não encontrado');
    }

    // 3️⃣ ACCEPTEDPROPOSAL
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('3️⃣  ACCEPTEDPROPOSAL');
    console.log('═══════════════════════════════════════════════════════════');
    const acceptedProposals = await AcceptedProposal.find({ conversationId });
    if (acceptedProposals.length > 0) {
      console.log(`✅ Encontrados ${acceptedProposals.length} registro(s)`);
      acceptedProposals.forEach((ap, idx) => {
        console.log(`\n   [${idx + 1}] _id: ${ap._id}`);
        console.log(`       status: ${ap.status} ${ap.status === 'cancelled' ? '✅' : '❌'}`);
        console.log(`       cancelledAt: ${ap.cancelledAt} ${ap.cancelledAt ? '✅' : '❌'}`);
        console.log(`       updatedAt: ${ap.updatedAt}`);
      });
    } else {
      console.log('❌ Nenhum encontrado');
    }

    // 4️⃣ BOOSTING_REQUESTS
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('4️⃣  BOOSTING_REQUESTS');
    console.log('═══════════════════════════════════════════════════════════');
    
    let boostingId = conversation?.metadata?.get?.('boostingId') || 
                     conversation?.proposal || 
                     conversation?.marketplaceItem;
    
    if (!boostingId && agreement) {
      boostingId = agreement.boostingId;
    }

    if (boostingId) {
      const boostingRequest = await BoostingRequest.findById(boostingId);
      if (boostingRequest) {
        console.log(`✅ Encontrado`);
        console.log(`   _id: ${boostingRequest._id}`);
        console.log(`   status: ${boostingRequest.status} ${boostingRequest.status === 'cancelled' ? '✅' : '❌'}`);
        console.log(`   cancelledAt: ${boostingRequest.cancelledAt} ${boostingRequest.cancelledAt ? '✅' : '❌'}`);
        console.log(`   updatedAt: ${boostingRequest.updatedAt}`);
      } else {
        console.log(`❌ Não encontrado (ID: ${boostingId})`);
      }
    } else {
      console.log('❌ boostingId não encontrado na Conversation ou Agreement');
    }

    // 5️⃣ BOOSTINGORDER (BÔNUS)
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('5️⃣  BOOSTINGORDER (BÔNUS)');
    console.log('═══════════════════════════════════════════════════════════');
    const boostingOrder = await BoostingOrder.findOne({ conversationId });
    if (boostingOrder) {
      console.log(`✅ Encontrado`);
      console.log(`   _id: ${boostingOrder._id}`);
      console.log(`   status: ${boostingOrder.status} ${boostingOrder.status === 'cancelled' ? '✅' : '❌'}`);
      console.log(`   cancelledAt: ${boostingOrder.cancelledAt} ${boostingOrder.cancelledAt ? '✅' : '❌'}`);
      console.log(`   updatedAt: ${boostingOrder.updatedAt}`);
    } else {
      console.log('❌ Não encontrado');
    }

    // RESUMO FINAL
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📋 RESUMO FINAL');
    console.log('═══════════════════════════════════════════════════════════');
    
    const conversationOk = conversation && 
                          conversation.isActive === false && 
                          conversation.boostingStatus === 'cancelled' && 
                          conversation.status === 'cancelled' && 
                          conversation.isFinalized === true;
    
    const agreementOk = agreement && agreement.status === 'cancelled' && agreement.cancelledAt;
    
    const acceptedProposalOk = acceptedProposals.length > 0 && 
                               acceptedProposals.every(ap => ap.status === 'cancelled' && ap.cancelledAt);
    
    const boostingRequestOk = boostingId && 
                              (await BoostingRequest.findById(boostingId)) && 
                              (await BoostingRequest.findById(boostingId)).status === 'cancelled';

    console.log(`1️⃣  Conversation: ${conversationOk ? '✅ OK' : '❌ ERRO'}`);
    console.log(`2️⃣  Agreement: ${agreementOk ? '✅ OK' : '❌ ERRO'}`);
    console.log(`3️⃣  AcceptedProposal: ${acceptedProposalOk ? '✅ OK' : '❌ ERRO'}`);
    console.log(`4️⃣  BoostingRequest: ${boostingRequestOk ? '✅ OK' : '❌ ERRO'}`);

    const allOk = conversationOk && agreementOk && acceptedProposalOk && boostingRequestOk;
    console.log(`\n${allOk ? '✅ TODAS AS 4 COLLECTIONS FORAM ATUALIZADAS CORRETAMENTE!' : '❌ ALGUMAS COLLECTIONS NÃO FORAM ATUALIZADAS'}`);

    process.exit(allOk ? 0 : 1);
  } catch (error) {
    console.error('❌ Erro ao verificar collections:', error.message);
    process.exit(1);
  }
}

// Conectar ao MongoDB e executar verificação
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hacklote')
  .then(() => {
    console.log('✅ Conectado ao MongoDB\n');
    return verifyAllCollections();
  })
  .catch(error => {
    console.error('❌ Erro ao conectar ao MongoDB:', error.message);
    process.exit(1);
  })
  .finally(() => {
    mongoose.connection.close();
  });

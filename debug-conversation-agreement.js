const mongoose = require('mongoose');
require('dotenv').config();

const Agreement = require('./src/models/Agreement');
const AcceptedProposal = require('./src/models/AcceptedProposal');
const Conversation = require('./src/models/Conversation');

const conversationId = process.argv[2];

if (!conversationId) {
  console.error('❌ Usage: node debug-conversation-agreement.js <conversationId>');
  process.exit(1);
}

async function debug() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Conectado ao MongoDB');
    console.log(`🔍 Debugando conversationId: ${conversationId}\n`);
    
    // 1. Buscar Conversation
    console.log('=' .repeat(80));
    console.log('📋 1. CONVERSATION');
    console.log('='.repeat(80));
    
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      console.log('✅ Conversation encontrada:');
      console.log(`   _id: ${conversation._id}`);
      console.log(`   isTemporary: ${conversation.isTemporary}`);
      console.log(`   status: ${conversation.status}`);
      console.log(`   boostingStatus: ${conversation.boostingStatus}`);
      console.log(`   participants: ${conversation.participants?.join(', ')}`);
      console.log(`   metadata:`, conversation.metadata instanceof Map 
        ? Object.fromEntries(conversation.metadata) 
        : conversation.metadata);
    } else {
      console.log('❌ Conversation NÃO encontrada');
    }
    
    // 2. Buscar Agreement com conversationId
    console.log('\n' + '='.repeat(80));
    console.log('📋 2. AGREEMENT (busca por conversationId)');
    console.log('='.repeat(80));
    
    const agreement = await Agreement.findOne({ conversationId });
    if (agreement) {
      console.log('✅ Agreement encontrado:');
      console.log(`   _id: ${agreement._id}`);
      console.log(`   agreementId: ${agreement.agreementId}`);
      console.log(`   conversationId: ${agreement.conversationId}`);
      console.log(`   conversationId type: ${typeof agreement.conversationId}`);
      console.log(`   conversationId toString: ${agreement.conversationId?.toString()}`);
      console.log(`   proposalId: ${agreement.proposalId}`);
      console.log(`   status: ${agreement.status}`);
      console.log(`   parties.client.userid: ${agreement.parties?.client?.userid}`);
      console.log(`   parties.booster.userid: ${agreement.parties?.booster?.userid}`);
      console.log(`   proposalSnapshot.price: ${agreement.proposalSnapshot?.price}`);
    } else {
      console.log('❌ Agreement NÃO encontrado com { conversationId }');
      
      // Tentar buscar com conversationId como string
      console.log('\n🔍 Tentando buscar Agreement com conversationId como string...');
      const agreementAsString = await Agreement.findOne({ 
        conversationId: conversationId.toString() 
      });
      
      if (agreementAsString) {
        console.log('✅ Agreement encontrado com conversationId STRING:');
        console.log(`   _id: ${agreementAsString._id}`);
        console.log(`   conversationId: ${agreementAsString.conversationId}`);
      } else {
        console.log('❌ Agreement não encontrado nem com string');
      }
      
      // Listar TODOS os Agreements
      console.log('\n🔍 Listando TODOS os Agreements no banco...');
      const allAgreements = await Agreement.find({}).limit(10).lean();
      console.log(`   Total de Agreements: ${await Agreement.countDocuments({})}`);
      
      if (allAgreements.length > 0) {
        console.log(`   Mostrando primeiros ${allAgreements.length}:`);
        allAgreements.forEach((agr, idx) => {
          console.log(`   ${idx + 1}. agreementId: ${agr.agreementId}`);
          console.log(`      conversationId: ${agr.conversationId}`);
          console.log(`      status: ${agr.status}`);
          console.log(`      createdAt: ${agr.createdAt}`);
        });
      }
    }
    
    // 3. Buscar AcceptedProposal com conversationId
    console.log('\n' + '='.repeat(80));
    console.log('📋 3. ACCEPTED PROPOSAL (busca por conversationId)');
    console.log('='.repeat(80));
    
    const acceptedProposal = await AcceptedProposal.findOne({ conversationId });
    if (acceptedProposal) {
      console.log('✅ AcceptedProposal encontrado:');
      console.log(`   _id: ${acceptedProposal._id}`);
      console.log(`   conversationId: ${acceptedProposal.conversationId}`);
      console.log(`   client.userid: ${acceptedProposal.client?.userid}`);
      console.log(`   booster.userid: ${acceptedProposal.booster?.userid}`);
      console.log(`   price: ${acceptedProposal.price}`);
      console.log(`   status: ${acceptedProposal.status}`);
    } else {
      console.log('❌ AcceptedProposal NÃO encontrado');
      
      // Listar todos AcceptedProposals
      console.log('\n🔍 Listando TODOS os AcceptedProposals no banco...');
      const allProposals = await AcceptedProposal.find({}).limit(10).lean();
      console.log(`   Total de AcceptedProposals: ${await AcceptedProposal.countDocuments({})}`);
      
      if (allProposals.length > 0) {
        console.log(`   Mostrando primeiros ${allProposals.length}:`);
        allProposals.forEach((prop, idx) => {
          console.log(`   ${idx + 1}. conversationId: ${prop.conversationId}`);
          console.log(`      price: ${prop.price}`);
          console.log(`      status: ${prop.status}`);
        });
      }
    }
    
    // 4. Resumo
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMO');
    console.log('='.repeat(80));
    console.log(`Conversation existe: ${conversation ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`Agreement existe: ${agreement ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`AcceptedProposal existe: ${acceptedProposal ? '✅ SIM' : '❌ NÃO'}`);
    
    if (!agreement && !acceptedProposal) {
      console.log('\n⚠️ PROBLEMA IDENTIFICADO:');
      console.log('   Nenhum Agreement ou AcceptedProposal encontrado para esta conversa.');
      console.log('   Isso causa o erro: "Nenhum acordo encontrado para esta conversa"');
      console.log('\n💡 SOLUÇÃO:');
      console.log('   1. Verificar se o Agreement foi criado ao aceitar a proposta');
      console.log('   2. Verificar logs do endpoint POST /api/proposals/:proposalId/accept');
      console.log('   3. Pode ter havido erro silencioso na criação do Agreement');
    }
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Desconectado do MongoDB');
  }
}

debug();

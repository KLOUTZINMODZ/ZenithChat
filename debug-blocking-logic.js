const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();


mongoose.connect(process.env.MONGODB_URI);

const Conversation = require('./src/models/Conversation');
const Agreement = require('./src/models/Agreement');
const AcceptedProposal = require('./src/models/AcceptedProposal');

async function debugBlockingLogic() {
  console.log('🔍 Debug: Lógica de Bloqueio de Mensagens');
  console.log('========================================\n');

  const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';
  const USER_ID = '68a27017da1e592e291956df1';

  try {

    const conversation = await Conversation.findById(CONVERSATION_ID).lean();
    console.log('📊 Estado da Conversa:');
    console.log(`  boostingStatus: ${conversation.boostingStatus}`);
    console.log(`  isActive: ${conversation.isActive}`);
    console.log(`  status: ${conversation.metadata?.status}`);


    console.log('\n📋 Verificando Agreements:');
    const activeAgreements = await Agreement.find({ 
      conversationId: CONVERSATION_ID, 
      status: 'active'
    }).lean();
    
    console.log(`  Agreements ativos: ${activeAgreements.length}`);
    activeAgreements.forEach((agreement, idx) => {
      console.log(`    ${idx + 1}. Status: ${agreement.status}, ID: ${agreement.agreementId}`);
    });


    const allAgreements = await Agreement.find({ 
      conversationId: CONVERSATION_ID 
    }).lean();
    
    console.log(`  Total de Agreements: ${allAgreements.length}`);
    allAgreements.forEach((agreement, idx) => {
      console.log(`    ${idx + 1}. Status: ${agreement.status}, Created: ${agreement.createdAt}`);
    });


    console.log('\n📋 Verificando AcceptedProposals:');
    const activeProposals = await AcceptedProposal.find({
      conversationId: CONVERSATION_ID,
      status: 'active'
    }).lean();
    
    console.log(`  Proposals ativos: ${activeProposals.length}`);
    activeProposals.forEach((proposal, idx) => {
      console.log(`    ${idx + 1}. Status: ${proposal.status}, ID: ${proposal._id}`);
    });


    const allProposals = await AcceptedProposal.find({
      conversationId: CONVERSATION_ID
    }).lean();
    
    console.log(`  Total de Proposals: ${allProposals.length}`);
    allProposals.forEach((proposal, idx) => {
      console.log(`    ${idx + 1}. Status: ${proposal.status}, Created: ${proposal.createdAt}`);
    });


    console.log('\n🧪 Simulando Lógica de Bloqueio:');
    console.log(`  boostingStatus === 'completed': ${conversation.boostingStatus === 'completed'}`);
    
    if (conversation.boostingStatus === 'completed') {
      const hasActiveAgreement = activeAgreements.length > 0;
      const hasActiveProposal = activeProposals.length > 0;
      
      console.log(`  Tem Agreement ativo: ${hasActiveAgreement}`);
      console.log(`  Tem Proposal ativo: ${hasActiveProposal}`);
      
      if (!hasActiveAgreement && !hasActiveProposal) {
        console.log('  🔒 RESULTADO: Mensagens devem ser BLOQUEADAS');
      } else {
        console.log('  ✅ RESULTADO: Mensagens são PERMITIDAS');
      }
    } else {
      console.log('  ✅ RESULTADO: boostingStatus não é completed - mensagens permitidas');
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    mongoose.connection.close();
  }
}

debugBlockingLogic();

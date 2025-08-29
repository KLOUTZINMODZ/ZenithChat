const mongoose = require('mongoose');
require('dotenv').config();


mongoose.connect(process.env.MONGODB_URI);

const AcceptedProposal = require('./src/models/AcceptedProposal');

async function fixProposalStatus() {
  console.log('🔧 Corrigindo Status do AcceptedProposal');
  console.log('======================================\n');

  const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

  try {

    const proposal = await AcceptedProposal.findOneAndUpdate(
      { 
        conversationId: CONVERSATION_ID,
        status: 'active'
      },
      {
        $set: {
          status: 'completed',
          completedAt: new Date()
        }
      },
      { new: true }
    );

    if (proposal) {
      console.log('✅ AcceptedProposal corrigido:');
      console.log(`  ID: ${proposal._id}`);
      console.log(`  Status: ${proposal.status}`);
      console.log(`  CompletedAt: ${proposal.completedAt}`);
    } else {
      console.log('❌ Nenhuma proposta ativa encontrada para corrigir');
    }

  } catch (error) {
    console.error('❌ Erro ao corrigir proposta:', error);
  } finally {
    mongoose.connection.close();
  }
}

fixProposalStatus();

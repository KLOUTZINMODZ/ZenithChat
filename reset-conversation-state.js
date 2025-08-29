const mongoose = require('mongoose');
require('dotenv').config();


mongoose.connect(process.env.MONGODB_URI);

const Conversation = require('./src/models/Conversation');

async function resetConversationState() {
  console.log('🔧 Resetando Estado da Conversa');
  console.log('================================\n');

  const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

  try {

    const result = await Conversation.findByIdAndUpdate(CONVERSATION_ID, {
      $set: {
        isActive: true,
        boostingStatus: 'completed',
        'metadata.status': 'delivery_confirmed'
      },
      $unset: {
        isFinalized: 1,
        finalizedAt: 1,
        finalizedBy: 1,
        closedAt: 1
      }
    }, { new: true });

    if (result) {
      console.log('✅ Conversa resetada com sucesso:');
      console.log(`  isActive: ${result.isActive}`);
      console.log(`  isFinalized: ${result.isFinalized}`);
      console.log(`  boostingStatus: ${result.boostingStatus}`);
      console.log(`  finalizedAt: ${result.finalizedAt}`);
      console.log(`  closedAt: ${result.closedAt}`);
    } else {
      console.log('❌ Conversa não encontrada');
    }

  } catch (error) {
    console.error('❌ Erro ao resetar conversa:', error);
  } finally {
    mongoose.connection.close();
  }
}

resetConversationState();

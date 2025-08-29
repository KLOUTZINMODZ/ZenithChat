const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI);

const Conversation = require('./src/models/Conversation');

async function resetConversationState() {
  console.log('🔧 Resetando Estado da Conversa');
  console.log('================================\n');

  const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

  try {
    // Resetar conversa para estado correto
    const result = await Conversation.findByIdAndUpdate(CONVERSATION_ID, {
      $set: {
        isActive: true,  // Reativar chat
        boostingStatus: 'completed', // Manter como completado
        'metadata.status': 'delivery_confirmed'
      },
      $unset: {
        isFinalized: 1,  // Remover finalização
        finalizedAt: 1,  // Remover timestamp de finalização
        finalizedBy: 1,  // Remover quem finalizou
        closedAt: 1      // Remover fechamento
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

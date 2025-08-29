const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI);

const Conversation = require('./src/models/Conversation');

async function debugConversationState() {
  console.log('🔍 Debug: Estado da Conversa no MongoDB');
  console.log('=======================================\n');

  const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

  try {
    // Buscar conversa diretamente no banco
    const conversation = await Conversation.findById(CONVERSATION_ID).lean();

    if (!conversation) {
      console.log('❌ Conversa não encontrada');
      return;
    }

    console.log('📊 Estado atual da conversa:');
    console.log(`ID: ${conversation._id}`);
    console.log(`isActive: ${conversation.isActive}`);
    console.log(`isFinalized: ${conversation.isFinalized}`);
    console.log(`boostingStatus: ${conversation.boostingStatus}`);
    console.log(`isReported: ${conversation.isReported}`);
    console.log(`finalizedAt: ${conversation.finalizedAt}`);
    console.log(`finalizedBy: ${conversation.finalizedBy}`);
    console.log(`deliveryConfirmedAt: ${conversation.deliveryConfirmedAt}`);
    console.log(`closedAt: ${conversation.closedAt}`);
    
    console.log('\n📋 Metadata:');
    if (conversation.metadata && typeof conversation.metadata === 'object') {
      Object.entries(conversation.metadata).forEach(([key, value]) => {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      });
    } else {
      console.log('  Nenhuma metadata encontrada');
    }

    console.log('\n🔧 Análise do problema:');
    if (conversation.isActive === false) {
      console.log('❌ PROBLEMA: isActive está como false');
      if (conversation.isFinalized) {
        console.log('   Causa: Conversa foi finalizada');
        console.log(`   Finalizada em: ${conversation.finalizedAt}`);
        console.log(`   Finalizada por: ${conversation.finalizedBy}`);
      } else {
        console.log('   Causa: isActive foi definido como false sem finalizar');
      }
    } else {
      console.log('✅ isActive está correto (true ou undefined)');
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    mongoose.connection.close();
  }
}

debugConversationState();

const mongoose = require('mongoose');
require('dotenv').config();


mongoose.connect(process.env.MONGODB_URI);

const Message = require('./src/models/Message');

async function checkBoosterMessages() {
  console.log('🔍 Verificando Mensagens para Booster');
  console.log('====================================\n');

  const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

  try {

    const boosterMessages = await Message.find({
      conversation: CONVERSATION_ID,
      'metadata.type': 'booster_notification'
    }).lean();

    console.log(`📊 Mensagens para booster encontradas: ${boosterMessages.length}\n`);

    if (boosterMessages.length === 0) {
      console.log('❌ Nenhuma mensagem específica para booster encontrada');
      

      const systemMessages = await Message.find({
        conversation: CONVERSATION_ID,
        type: 'message:new',
        createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) }
      }).lean();

      console.log(`\n📋 Mensagens system dos últimos 10 minutos: ${systemMessages.length}`);
      systemMessages.forEach((msg, idx) => {
        console.log(`  ${idx + 1}. Conteúdo: ${msg.content?.substring(0, 100)}...`);
        console.log(`     Metadata: ${JSON.stringify(msg.metadata)}`);
        console.log('     ---');
      });
      
    } else {
      boosterMessages.forEach((msg, idx) => {
        console.log(`${idx + 1}. Mensagem para Booster:`);
        console.log(`   Conteúdo: ${msg.content}`);
        console.log(`   Target User: ${msg.metadata?.targetUser}`);
        console.log(`   Criado em: ${msg.createdAt}`);
        console.log('   ---');
      });
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    mongoose.connection.close();
  }
}

checkBoosterMessages();

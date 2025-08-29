const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI);

const Message = require('./src/models/Message');

async function debugMessages() {
  console.log('🔍 Debug: Verificando mensagens no banco');
  console.log('========================================\n');

  const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

  try {
    // Buscar todas as mensagens da conversa diretamente no MongoDB
    const messages = await Message.find({ conversation: CONVERSATION_ID })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    console.log(`📊 Total de mensagens encontradas: ${messages.length}\n`);

    messages.forEach((msg, idx) => {
      console.log(`${idx + 1}. ID: ${msg._id}`);
      console.log(`   Tipo: ${msg.type}`);
      console.log(`   Sender: ${msg.sender}`);
      console.log(`   Conteúdo: ${msg.content?.substring(0, 100)}...`);
      console.log(`   Criado em: ${msg.createdAt}`);
      if (msg.metadata) {
        console.log(`   Metadata: ${JSON.stringify(msg.metadata)}`);
      }
      console.log('   ---');
    });

    // Verificar se há mensagens muito recentes (últimos 5 minutos)
    const recentMessages = await Message.find({
      conversation: CONVERSATION_ID,
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Últimos 5 minutos
    }).lean();

    console.log(`\n📅 Mensagens dos últimos 5 minutos: ${recentMessages.length}`);
    recentMessages.forEach((msg, idx) => {
      console.log(`  ${idx + 1}. [${msg.type}] ${msg.content?.substring(0, 50)}... (${msg.createdAt})`);
    });

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    mongoose.connection.close();
  }
}

debugMessages();

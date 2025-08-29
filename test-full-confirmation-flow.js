const axios = require('axios');


const API_BASE = 'http://localhost:3001/api';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YTI3MDE3ZGExZTU5MmUyOTE5NWRmMSIsImlhdCI6MTc1NjE5NDk4MiwiZXhwIjoxNzU2Nzk5NzgyfQ.Qy8HEz4X6iWiPm-hkO8P40nSUw2T7elzWXRzuJt1fgo';
const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

const config = {
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

async function testFullConfirmationFlow() {
  console.log('🧪 Testando Fluxo Completo de Confirmação');
  console.log('=======================================\n');

  try {

    console.log('📝 1. Confirmando entrega:');
    const confirmResponse = await axios.post(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/confirm-delivery`,
      {},
      config
    );
    console.log('✅ Confirmação:', confirmResponse.data.message);


    console.log('\n📝 2. Verificando mensagens geradas:');
    const messagesResponse = await axios.get(
      `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages?limit=10`,
      config
    );
    
    const messages = messagesResponse.data?.data?.messages || messagesResponse.data?.messages || [];
    console.log(`Total de mensagens: ${messages.length}`);
    console.log('Estrutura da resposta:', Object.keys(messagesResponse.data));
    
    messages.forEach((msg, idx) => {
      console.log(`  ${idx + 1}. [${msg.type}] ${msg.content?.substring(0, 100)}...`);
      if (msg.metadata?.type) {
        console.log(`     Tipo: ${msg.metadata.type}`);
      }
      if (msg.metadata?.targetUser) {
        console.log(`     Target User: ${msg.metadata.targetUser}`);
      }
    });


    console.log('\n📝 3. Testando bloqueio após confirmação:');
    try {
      await axios.post(
        `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages`,
        {
          content: 'Teste após confirmação',
          type: 'text'
        },
        config
      );
      console.log('❌ Erro: Mensagem foi enviada (não deveria)');
    } catch (error) {
      if (error.response?.status === 423) {
        console.log('✅ Chat bloqueado corretamente:', error.response.data.message);
      } else {
        console.log('❌ Erro inesperado:', error.response?.status, error.response?.data);
      }
    }


    console.log('\n📝 4. Status final da conversa:');
    const statusResponse = await axios.get(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
      config
    );
    
    console.log('Status:', JSON.stringify(statusResponse.data, null, 2));

  } catch (error) {
    console.log('❌ Erro geral:', error.response?.data || error.message);
  }
}

testFullConfirmationFlow()
  .then(() => console.log('\n🏁 Teste completo finalizado'))
  .catch(error => console.error('💥 Erro:', error.message));

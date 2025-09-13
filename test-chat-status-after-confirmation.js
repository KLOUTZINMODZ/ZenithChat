const axios = require('axios');


const API_BASE = 'http://vast-beans-agree.loca.lt/api';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YTI3MDE3ZGExZTU5MmUyOTE5NWRmMSIsImlhdCI6MTc1NjE5NDk4MiwiZXhwIjoxNzU2Nzk5NzgyfQ.Qy8HEz4X6iWiPm-hkO8P40nSUw2T7elzWXRzuJt1fgo';
const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

const config = {
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

async function testChatStatusAfterConfirmation() {
  console.log('🔍 Testando Status do Chat Após Confirmação');
  console.log('=============================================\n');

  try {

    console.log('📝 1. Verificando status da conversa:');
    const statusResponse = await axios.get(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
      config
    );
    
    console.log('Status completo:', JSON.stringify(statusResponse.data, null, 2));
    

    console.log('\n📝 2. Testando envio de mensagem:');
    
    try {
      const messageResponse = await axios.post(
        `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages`,
        {
          content: 'Teste de mensagem após confirmação',
          type: 'text'
        },
        config
      );
      
      console.log('✅ Mensagem enviada:', messageResponse.data.message);
      
    } catch (error) {
      if (error.response?.status === 423) {
        console.log('🔒 Chat bloqueado para mensagens (esperado):', error.response.data.message);
      } else {
        console.log('❌ Erro inesperado:', error.response?.status, error.response?.data);
      }
    }


    console.log('\n📝 3. Verificando Agreement:');
    
    try {
      const agreementResponse = await axios.get(
        `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/proposal`,
        config
      );
      
      console.log('Agreement/Proposal:', JSON.stringify(agreementResponse.data, null, 2));
      
    } catch (error) {
      console.log('❌ Erro ao buscar Agreement:', error.response?.status, error.response?.data);
    }


    console.log('\n📝 4. Verificando mensagens recentes:');
    
    try {
      const messagesResponse = await axios.get(
        `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages?limit=5`,
        config
      );
      
      const messages = messagesResponse.data.messages || [];
      console.log(`Últimas ${messages.length} mensagens:`);
      messages.forEach((msg, idx) => {
        console.log(`  ${idx + 1}. [${msg.type}] ${msg.content?.substring(0, 50)}...`);
      });
      
    } catch (error) {
      console.log('❌ Erro ao buscar mensagens:', error.response?.status, error.response?.data);
    }

  } catch (error) {
    console.log('❌ Erro geral:', error.message);
  }
}

testChatStatusAfterConfirmation()
  .then(() => console.log('\n🏁 Diagnóstico concluído'))
  .catch(error => console.error('💥 Erro:', error.message));

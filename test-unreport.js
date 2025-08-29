const axios = require('axios');

// Configuração
const API_BASE = 'http://localhost:3001/api';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4OTdkODJjOGNkZDQwMTg4ZTA4YTIyNCIsImlhdCI6MTc1NjE3NDExNywiZXhwIjoxNzU2Nzc4OTE3fQ.ePaG5v7D1J4Vz3ml_cnVBYlk517fs96z4I95BUhI0nI';
const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

const config = {
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

async function unreportAndTest() {
  console.log('🔓 Desbloqueando Conversa Reportada');
  console.log('====================================\n');

  try {
    // 1. Desbloquear conversa
    console.log('📝 Passo 1: Desbloquear conversa');
    const unreportResponse = await axios.post(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/unreport`,
      {},
      config
    );
    
    console.log('✅ Conversa desbloqueada:', unreportResponse.data.message);
    console.log('Mensagem de sistema:', unreportResponse.data.systemMessage.content);

    // 2. Verificar novo status
    console.log('\n📝 Passo 2: Verificar novo status');
    const statusResponse = await axios.get(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
      config
    );
    
    console.log('Novo status:', JSON.stringify(statusResponse.data, null, 2));
    
    if (!statusResponse.data.isReported) {
      console.log('✅ Conversa desbloqueada com sucesso!');
    } else {
      console.log('❌ Conversa ainda está reportada');
    }

    // 3. Testar envio de mensagem
    console.log('\n📝 Passo 3: Testar envio de mensagem');
    const messageResponse = await axios.post(
      `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages`,
      {
        content: '🎉 Chat reativado! Nova proposta aceita - vamos começar!',
        type: 'text'
      },
      config
    );
    
    console.log('✅ Mensagem enviada com sucesso!');
    console.log('ID da mensagem:', messageResponse.data.message._id);

    console.log('\n🎯 RESULTADO: Chat funcionando normalmente!');

  } catch (error) {
    console.log('❌ Erro:', error.response?.status, error.response?.data?.message || error.message);
    
    if (error.response?.status === 423) {
      console.log('🚫 Chat ainda está bloqueado - tente novamente');
    }
  }
}

unreportAndTest()
  .then(() => console.log('\n🏁 Desbloqueio concluído'))
  .catch(error => console.error('💥 Erro:', error.message));

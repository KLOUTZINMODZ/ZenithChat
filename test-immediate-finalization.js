const axios = require('axios');


const API_BASE = 'http://zenith.enrelyugi.com.br/api';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YTI3MDE3ZGExZTU5MmUyOTE5NWRmMSIsImlhdCI6MTc1NjE5NDk4MiwiZXhwIjoxNzU2Nzk5NzgyfQ.Qy8HEz4X6iWiPm-hkO8P40nSUw2T7elzWXRzuJt1fgo';
const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

const config = {
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

async function testImmediateFinalization() {
  console.log('🧪 Testando Finalização Imediata do Chat');
  console.log('=====================================\n');

  try {

    console.log('📝 1. Confirmando entrega (finalização imediata):');
    const confirmResponse = await axios.post(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/confirm-delivery`,
      {},
      config
    );
    console.log('✅ Confirmação:', confirmResponse.data.message);


    console.log('\n📝 2. Status imediatamente após confirmação:');
    const statusResponse = await axios.get(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
      config
    );
    
    const status = statusResponse.data;
    console.log('Status:', JSON.stringify(status, null, 2));
    

    if (status.boostingStatus === 'completed' && !status.isActive) {
      console.log('✅ Chat finalizado corretamente (isActive=false, boostingStatus=completed)');
    } else {
      console.log('❌ Chat não foi finalizado corretamente');
      console.log(`   isActive: ${status.isActive}, boostingStatus: ${status.boostingStatus}`);
    }


    console.log('\n📝 3. Testando bloqueio imediato:');
    try {
      await axios.post(
        `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages`,
        {
          content: 'Teste após finalização imediata',
          type: 'text'
        },
        config
      );
      console.log('❌ Erro: Mensagem foi enviada (não deveria)');
    } catch (error) {
      if (error.response?.status === 423) {
        console.log('✅ Chat bloqueado imediatamente:', error.response.data.message);
        console.log('   Tipo de erro:', error.response.data.error);
      } else {
        console.log('❌ Erro inesperado:', error.response?.status, error.response?.data);
      }
    }


    console.log('\n📝 4. Verificando mensagens de finalização:');
    const messagesResponse = await axios.get(
      `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages?limit=5`,
      config
    );
    
    const messages = messagesResponse.data?.data?.messages || [];
    console.log(`Total de mensagens: ${messages.length}`);
    
    messages.forEach((msg, idx) => {
      if (msg.type === 'system') {
        console.log(`  ${idx + 1}. [${msg.type}] ${msg.content?.substring(0, 80)}...`);
        if (msg.metadata?.type) {
          console.log(`     Tipo: ${msg.metadata.type}`);
        }
      }
    });


    console.log('\n📝 5. Simulando refresh da página:');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const refreshStatusResponse = await axios.get(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
      config
    );
    
    const refreshStatus = refreshStatusResponse.data;
    if (!refreshStatus.isActive && refreshStatus.boostingStatus === 'completed') {
      console.log('✅ Status mantido após refresh (chat permanece finalizado)');
    } else {
      console.log('❌ Status alterado após refresh');
      console.log('Status após refresh:', JSON.stringify(refreshStatus, null, 2));
    }

  } catch (error) {
    console.log('❌ Erro geral:', error.response?.data || error.message);
  }
}

testImmediateFinalization()
  .then(() => console.log('\n🏁 Teste de finalização imediata concluído'))
  .catch(error => console.error('💥 Erro:', error.message));

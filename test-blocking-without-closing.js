const axios = require('axios');


const API_BASE = 'http://localhost:5000/api';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YTI3MDE3ZGExZTU5MmUyOTE5NWRmMSIsImlhdCI6MTc1NjE5NDk4MiwiZXhwIjoxNzU2Nzk5NzgyfQ.Qy8HEz4X6iWiPm-hkO8P40nSUw2T7elzWXRzuJt1fgo';
const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

const config = {
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

async function testBlockingWithoutClosing() {
  console.log('🧪 Testando Bloqueio de Mensagens Sem Fechar Chat');
  console.log('===============================================\n');

  try {

    console.log('📝 1. Confirmando entrega (bloqueio sem fechamento):');
    const confirmResponse = await axios.post(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/confirm-delivery`,
      {},
      config
    );
    console.log('✅ Confirmação:', confirmResponse.data.message);


    console.log('\n📝 2. Status após confirmação:');
    const statusResponse = await axios.get(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
      config
    );
    
    const status = statusResponse.data;
    console.log('Status:', JSON.stringify(status, null, 2));
    

    if (status.boostingStatus === 'completed' && status.isActive !== false) {
      console.log('✅ Chat permanece aberto (não foi fechado)');
    } else {
      console.log('❌ Chat foi fechado incorretamente');
      console.log(`   isActive: ${status.isActive}, boostingStatus: ${status.boostingStatus}`);
    }


    console.log('\n📝 3. Testando bloqueio de mensagens:');
    try {
      await axios.post(
        `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages`,
        {
          content: 'Teste de mensagem após entrega confirmada',
          type: 'text'
        },
        config
      );
      console.log('❌ Erro: Mensagem foi enviada (deveria estar bloqueada)');
    } catch (error) {
      if (error.response?.status === 423) {
        console.log('✅ Mensagens bloqueadas corretamente:', error.response.data.message);
        console.log('   Tipo de erro:', error.response.data.error);
      } else {
        console.log('❌ Erro inesperado:', error.response?.status, error.response?.data);
      }
    }


    console.log('\n📝 4. Verificando persistência após refresh:');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      await axios.post(
        `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages`,
        {
          content: 'Teste após refresh',
          type: 'text'
        },
        config
      );
      console.log('❌ Erro: Mensagem foi enviada após refresh (deveria estar bloqueada)');
    } catch (error) {
      if (error.response?.status === 423) {
        console.log('✅ Bloqueio mantido após refresh:', error.response.data.message);
      } else {
        console.log('❌ Erro inesperado após refresh:', error.response?.status);
      }
    }


    console.log('\n📝 5. Verificando que chat ainda está ativo (não fechado):');
    const finalStatusResponse = await axios.get(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
      config
    );
    
    if (finalStatusResponse.status === 200) {
      console.log('✅ Chat ainda está ativo (pode acessar status)');
      console.log(`   Status: ${finalStatusResponse.data.status}`);
      console.log(`   BoostingStatus: ${finalStatusResponse.data.boostingStatus}`);
    } else {
      console.log('❌ Chat parece estar inacessível');
    }

  } catch (error) {
    console.log('❌ Erro geral:', error.response?.data || error.message);
  }
}

testBlockingWithoutClosing()
  .then(() => console.log('\n🏁 Teste de bloqueio sem fechamento concluído'))
  .catch(error => console.error('💥 Erro:', error.message));

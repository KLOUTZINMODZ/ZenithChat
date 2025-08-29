const axios = require('axios');

// Configuração
const API_BASE = 'http://localhost:3001/api';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YTI3MDE3ZGExZTU5MmUyOTE5NWRmMSIsImlhdCI6MTc1NjE5NDk4MiwiZXhwIjoxNzU2Nzk5NzgyfQ.Qy8HEz4X6iWiPm-hkO8P40nSUw2T7elzWXRzuJt1fgo';
const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

const config = {
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

async function testConfirmDelivery() {
  console.log('🧪 Testando Confirmação de Entrega (Idempotência)');
  console.log('================================================\n');

  try {
    // Teste múltiplas confirmações (deve ser idempotente)
    for (let i = 1; i <= 3; i++) {
      console.log(`📝 Tentativa ${i}: Confirmar entrega`);
      
      try {
        const confirmResponse = await axios.post(
          `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/confirm-delivery`,
          {},
          config
        );
        
        console.log(`✅ Tentativa ${i}: Sucesso -`, confirmResponse.data.message);
        
      } catch (error) {
        if (error.response?.status === 400 && error.response.data.message?.includes('já completado')) {
          console.log(`✅ Tentativa ${i}: Idempotência funcionando -`, error.response.data.message);
        } else {
          console.log(`❌ Tentativa ${i}: Erro -`, error.response?.status, error.response?.data?.message);
        }
      }
      
      // Pequena pausa entre tentativas
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Verificar status final
    console.log('\n📝 Verificando status final:');
    const statusResponse = await axios.get(
      `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
      config
    );
    
    console.log('Status:', JSON.stringify(statusResponse.data, null, 2));

  } catch (error) {
    console.log('❌ Erro geral:', error.message);
  }
}

testConfirmDelivery()
  .then(() => console.log('\n🏁 Teste de idempotência concluído'))
  .catch(error => console.error('💥 Erro:', error.message));

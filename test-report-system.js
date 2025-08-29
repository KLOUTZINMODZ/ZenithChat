const axios = require('axios');

// Configuração da API
const API_BASE = 'http://localhost:3001/api';

// Token JWT válido (copie do log do usuário)
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4OTdkODJjOGNkZDQwMTg4ZTA4YTIyNCIsImlhdCI6MTc1NjE3NDExNywiZXhwIjoxNzU2Nzc4OTE3fQ.ePaG5v7D1J4Vz3ml_cnVBYlk517fs96z4I95BUhI0nI';

// Conversation ID do log
const CONVERSATION_ID = '68accd4f015ee7dc20e09fbf';

const config = {
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

async function testReportSystem() {
  console.log('🧪 Teste do Sistema de Report');
  console.log('=====================================\n');

  try {
    // Teste 1: Verificar se conversa existe
    console.log('📝 Teste 1: Verificar conversa');
    try {
      const conversationResponse = await axios.get(
        `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/proposal`,
        config
      );
      console.log('✅ Conversa encontrada:', conversationResponse.status);
    } catch (error) {
      console.log('❌ Erro na conversa:', error.response?.status, error.response?.data?.message);
    }

    // Teste 2: Tentar reportar (dados mínimos)
    console.log('\n📝 Teste 2: Report com dados mínimos');
    try {
      const reportData = {
        reason: 'Teste de funcionalidade',
        description: 'Teste automatizado do sistema de report',
        type: 'other'
      };

      console.log('Enviando report:', reportData);

      const reportResponse = await axios.post(
        `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/report`,
        reportData,
        config
      );

      console.log('✅ Report criado:', reportResponse.status);
      console.log('Response:', reportResponse.data);

    } catch (error) {
      console.log('❌ Erro no report:', error.response?.status);
      console.log('Mensagem:', error.response?.data?.message);
      console.log('Detalhes:', error.response?.data);
    }

    // Teste 3: Verificar se conversa foi marcada como reportada
    console.log('\n📝 Teste 3: Verificar status isReported da conversa');
    try {
      const statusResponse = await axios.get(
        `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/status`,
        config
      );
      console.log('✅ Status da conversa:', statusResponse.data);
      
      if (statusResponse.data?.isReported) {
        console.log('✅ Campo isReported definido corretamente');
      } else {
        console.log('❌ Campo isReported NÃO foi definido!');
      }
    } catch (error) {
      console.log('❌ Erro ao verificar status:', error.response?.status, error.response?.data?.message);
    }

    // Teste 4: Tentar enviar mensagem via endpoint correto
    console.log('\n📝 Teste 4: Verificar bloqueio via endpoint de mensagens');
    try {
      const messageData = {
        content: 'Teste de mensagem após report',
        type: 'text'
      };

      const messageResponse = await axios.post(
        `${API_BASE}/messages/conversations/${CONVERSATION_ID}/messages`,
        messageData,
        config
      );

      console.log('⚠️ Mensagem enviada via /messages (não deveria):', messageResponse.status);

    } catch (error) {
      if (error.response?.status === 423) {
        console.log('✅ Conversa bloqueada corretamente via /messages (HTTP 423)');
      } else {
        console.log('❌ Erro via /messages:', error.response?.status, error.response?.data?.message);
      }
    }

    // Teste 5: Tentar enviar via WebSocket/boosting-chat
    console.log('\n📝 Teste 5: Verificar outros endpoints de mensagem');
    const alternativeEndpoints = [
      `/boosting-chat/conversation/${CONVERSATION_ID}/send-message`,
      `/boosting-chat/messages/${CONVERSATION_ID}/send`,
      `/chat/conversation/${CONVERSATION_ID}/send`
    ];

    for (const endpoint of alternativeEndpoints) {
      try {
        const messageData = {
          content: 'Teste de mensagem após report',
          type: 'text'
        };

        const messageResponse = await axios.post(
          `${API_BASE}${endpoint}`,
          messageData,
          config
        );

        console.log(`⚠️ Mensagem enviada via ${endpoint} (não deveria):`, messageResponse.status);

      } catch (error) {
        if (error.response?.status === 423) {
          console.log(`✅ Bloqueio funcionando via ${endpoint} (HTTP 423)`);
        } else if (error.response?.status === 404) {
          console.log(`ℹ️ Endpoint ${endpoint} não existe (404)`);
        } else {
          console.log(`❌ Erro via ${endpoint}:`, error.response?.status, error.response?.data?.message);
        }
      }
    }

    // Teste 4: Report com dados completos
    console.log('\n📝 Teste 4: Report com dados completos');
    try {
      const fullReportData = {
        reason: 'Serviço não entregue',
        description: 'O booster não completou o serviço no prazo acordado e não está respondendo mensagens.',
        type: 'service_not_delivered',
        evidence: [
          'Captura de tela da conversa',
          'Print do prazo acordado'
        ]
      };

      const fullReportResponse = await axios.post(
        `${API_BASE}/boosting-chat/conversation/${CONVERSATION_ID}/report`,
        fullReportData,
        config
      );

      console.log('✅ Report completo criado:', fullReportResponse.status);

    } catch (error) {
      console.log('❌ Erro no report completo:', error.response?.status);
      console.log('Mensagem:', error.response?.data?.message);
    }

  } catch (error) {
    console.log('❌ Erro geral no teste:', error.message);
  }
}

// Executar teste
testReportSystem().then(() => {
  console.log('\n🏁 Teste concluído');
}).catch(error => {
  console.error('💥 Erro fatal:', error.message);
});

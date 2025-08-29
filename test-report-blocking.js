const axios = require('axios');


const BASE_URL = 'http://localhost:3001/api';
const TEST_JWT = 'your_test_jwt_token_here';

class ReportBlockingTest {
  constructor() {
    this.conversationId = null;
    this.reportId = null;
    this.testUserId = null;
  }

  async setup() {
    console.log('🚀 Iniciando teste do sistema de bloqueio por report...\n');
  }


  async testNormalMessageSending() {
    console.log('📝 Teste 1: Enviar mensagem em chat normal');
    
    try {
      const response = await axios.post(`${BASE_URL}/messages/conversations/675b6e7a2e5f8d001f123456/messages`, {
        content: 'Teste de mensagem normal',
        type: 'text'
      }, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        console.log('✅ Mensagem enviada com sucesso em chat normal');
        this.conversationId = '675b6e7a2e5f8d001f123456';
      } else {
        console.log('❌ Falha ao enviar mensagem:', response.data.message);
      }
    } catch (error) {
      console.log('⚠️ Erro no teste de mensagem normal:', error.response?.data?.message || error.message);
    }
    console.log('');
  }


  async testReportChat() {
    console.log('🚨 Teste 2: Reportar chat');
    
    if (!this.conversationId) {
      console.log('❌ Erro: Nenhuma conversa disponível para reportar');
      return;
    }

    try {
      const response = await axios.post(`${BASE_URL}/boosting-chat/conversation/${this.conversationId}/report`, {
        type: 'inappropriate_content',
        description: 'Teste de denúncia - conteúdo inapropriado',
        evidence: ['Comportamento inadequado durante o atendimento']
      }, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        console.log('✅ Chat reportado com sucesso');
        this.reportId = response.data.reportId;
        

        console.log('⏳ Aguardando processamento do report (3s)...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.log('❌ Falha ao reportar chat:', response.data.message);
      }
    } catch (error) {
      console.log('⚠️ Erro ao reportar chat:', error.response?.data?.message || error.message);
    }
    console.log('');
  }


  async testCheckReportedStatus() {
    console.log('🔍 Teste 3: Verificar status de chat reportado');
    
    try {

      const response = await axios.get(`${BASE_URL}/boosting-chat/conversation/${this.conversationId}/status`, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`
        }
      });

      console.log('📊 Status da conversa:', JSON.stringify(response.data, null, 2));
      
      if (response.data.conversation?.isReported) {
        console.log('✅ Chat marcado como reportado no backend');
      } else {
        console.log('❌ Chat NÃO foi marcado como reportado');
      }
    } catch (error) {
      console.log('⚠️ Erro ao verificar status:', error.response?.data?.message || error.message);
    }
    console.log('');
  }


  async testBlockedMessageSending() {
    console.log('🚫 Teste 4: Tentar enviar mensagem em chat reportado');
    
    try {
      const response = await axios.post(`${BASE_URL}/messages/conversations/${this.conversationId}/messages`, {
        content: 'Teste de mensagem em chat reportado - DEVE FALHAR',
        type: 'text'
      }, {
        headers: {
          'Authorization': `Bearer ${TEST_JWT}`,
          'Content-Type': 'application/json'
        }
      });


      console.log('❌ FALHA CRÍTICA: Mensagem foi enviada em chat reportado!');
      console.log('Response:', response.data);
    } catch (error) {
      if (error.response?.status === 423) {
        console.log('✅ Bloqueio funcionando: HTTP 423 Locked');
        console.log('📝 Mensagem:', error.response.data.message);
      } else {
        console.log('⚠️ Erro inesperado:', error.response?.data?.message || error.message);
      }
    }
    console.log('');
  }


  async testIdempotency() {
    console.log('🔄 Teste 5: Verificar idempotência de bloqueio');
    
    for (let i = 1; i <= 3; i++) {
      console.log(`Tentativa ${i}:`);
      try {
        await axios.post(`${BASE_URL}/messages/conversations/${this.conversationId}/messages`, {
          content: `Tentativa ${i} de burlar bloqueio`,
          type: 'text'
        }, {
          headers: {
            'Authorization': `Bearer ${TEST_JWT}`,
            'Content-Type': 'application/json'
          }
        });

        console.log('❌ Bloqueio falhou na tentativa', i);
      } catch (error) {
        if (error.response?.status === 423) {
          console.log(`✅ Bloqueio consistente na tentativa ${i}`);
        }
      }
    }
    console.log('');
  }


  async runAllTests() {
    await this.setup();
    await this.testNormalMessageSending();
    await this.testReportChat();
    await this.testCheckReportedStatus();
    await this.testBlockedMessageSending();
    await this.testIdempotency();
    
    console.log('🎯 Teste do sistema de bloqueio por report concluído!');
    console.log('📝 Próximo passo: Testar frontend UI');
  }
}


if (require.main === module) {
  const test = new ReportBlockingTest();
  test.runAllTests().catch(console.error);
}

module.exports = ReportBlockingTest;

/**
 * Teste para enviar uma notificação real via HackLoteAPI 
 * para verificar se chega no frontend via WebSocket
 */

const axios = require('axios');

const HACK_LOTE_API_URL = 'https://zenithapi-steel.vercel.app';
const CHAT_API_URL = 'https://12zku8.instatunnel.my/';

console.log('🧪 Testando notificação real via HackLoteAPI...');

async function testRealNotification() {
  try {
    // 1. Primeiro vamos testar se o endpoint do ChatApi está funcionando
    console.log('📡 Testando endpoint ChatApi diretamente...');
    
    const testResponse = await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: ['test_user_123'],
      notification: {
        id: `test_${Date.now()}`,
        title: 'Teste Direto ChatApi',
        message: 'Esta notificação foi enviada diretamente para o ChatApi',
        type: 'test',
        priority: 'high',
        timestamp: new Date().toISOString()
      },
      options: {
        persistent: true,
        retryOnFailure: true
      }
    });

    console.log('✅ Resposta ChatApi:', testResponse.data);

    // 2. Aguardar um pouco
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. Agora vamos simular uma notificação vinda do HackLoteAPI
    console.log('\n📨 Simulando notificação via HackLoteAPI...');
    
    // Simular o que o HackLoteAPI faria
    const hackLoteNotification = {
      userIds: 'test_user_123',
      notification: {
        id: `hacklote_${Date.now()}`,
        title: 'Nova Proposta Recebida!',
        message: 'João enviou uma proposta de R$ 150,00 para seu boosting de League of Legends',
        type: 'new_proposal',
        link: '/boosting/123/proposals',
        image: 'https://via.placeholder.com/40',
        timestamp: new Date().toISOString(),
        isRead: false
      },
      options: {
        persistent: true
      }
    };

    const hackLoteResponse = await axios.post(`${CHAT_API_URL}/api/notifications/send`, hackLoteNotification);
    
    console.log('✅ Notificação HackLote enviada:', hackLoteResponse.data);

    console.log('\n🔍 Verifique o frontend para ver se as notificações apareceram!');
    console.log('📱 Devem aparecer 2 notificações:');
    console.log('   1. "Teste Direto ChatApi"');
    console.log('   2. "Nova Proposta Recebida!"');

  } catch (error) {
    console.error('❌ Erro no teste:', error.response?.data || error.message);
  }
}

testRealNotification();

/**
 * Teste para notificações usando o user ID real do frontend
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');

const CHAT_API_URL = 'https://12zku8.instatunnel.my/';

console.log('🧪 Testando notificações com user ID real do frontend...');

async function testWithRealUserId() {
  try {
    console.log('📋 Instruções:');
    console.log('1. Abra o console do navegador no frontend');
    console.log('2. Execute: localStorage.getItem("token")');
    console.log('3. Cole o token abaixo quando solicitado');
    console.log('');


    const commonUserIds = [
      '675c123456789012345abcde',
      '675c987654321098765edcba',
      'user_123',
      'test_user_123'
    ];

    for (const userId of commonUserIds) {
      console.log(`\n📨 Enviando notificação para user ID: ${userId}`);
      
      try {
        const response = await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
          userIds: [userId],
          notification: {
            id: `test_${Date.now()}_${userId}`,
            title: `Teste para ${userId}`,
            message: `Esta é uma notificação de teste para o usuário ${userId}`,
            type: 'test',
            priority: 'high',
            timestamp: new Date().toISOString(),
            isRead: false
          }
        });

        console.log(`✅ Resposta para ${userId}:`, {
          success: response.data.success,
          delivered: response.data.results?.[0]?.delivered,
          userId: response.data.results?.[0]?.userId
        });

        if (response.data.results?.[0]?.delivered) {
          console.log('🎉 SUCESSO! Notificação entregue via WebSocket!');
        }

      } catch (error) {
        console.log(`❌ Erro para ${userId}:`, error.response?.data?.message || error.message);
      }


      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n🔍 Verificando conexões WebSocket ativas...');
    
    try {
      const healthResponse = await axios.get(`${CHAT_API_URL}/health`);
      console.log('🏥 Status do servidor:', healthResponse.data);
    } catch (error) {
      console.log('❌ Erro ao verificar status:', error.message);
    }

    console.log('\n📱 Instruções finais:');
    console.log('1. Se alguma notificação foi "delivered: true", ela deve aparecer no frontend');
    console.log('2. Verifique o console do navegador para ver logs de WebSocket');
    console.log('3. Se nenhuma foi entregue, o user ID do frontend é diferente dos testados');

  } catch (error) {
    console.error('❌ Erro geral no teste:', error.message);
  }
}


async function testSpecificUserId(userId) {
  if (!userId) {
    console.log('❌ User ID não fornecido');
    return;
  }

  console.log(`\n🎯 Testando com user ID específico: ${userId}`);
  
  try {
    const response = await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [userId],
      notification: {
        id: `specific_${Date.now()}`,
        title: 'Notificação Direcionada',
        message: 'Esta notificação foi enviada para seu user ID específico!',
        type: 'targeted_test',
        priority: 'high',
        timestamp: new Date().toISOString(),
        isRead: false
      }
    });

    console.log('✅ Resultado:', response.data);
    
    if (response.data.results?.[0]?.delivered) {
      console.log('🎉 Notificação entregue com sucesso via WebSocket!');
    } else {
      console.log('⚠️ Notificação enviada mas não entregue (usuário offline)');
    }

  } catch (error) {
    console.error('❌ Erro:', error.response?.data || error.message);
  }
}


const specificUserId = process.argv[2];
if (specificUserId) {
  testSpecificUserId(specificUserId);
} else {
  testWithRealUserId();
}

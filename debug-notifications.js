/**
 * Debug detalhado das notificações para identificar por que algumas funcionam e outras não
 */

const axios = require('axios');

const CHAT_API_URL = 'https://vast-beans-agree.loca.lt/';
const USER_ID = '6897d82c8cdd40188e08a224';

console.log('🔍 Debug detalhado das notificações...');

async function debugNotifications() {

  console.log('\n✅ TESTE 1: Notificação que FUNCIONA');
  const workingNotification = {
    userIds: [USER_ID],
    notification: {
      id: `working_${Date.now()}`,
      title: 'Notificação Direcionada',
      message: 'Esta notificação foi enviada para seu user ID específico!',
      type: 'targeted_test',
      priority: 'high',
      timestamp: new Date().toISOString(),
      isRead: false
    }
  };

  try {
    const response1 = await axios.post(`${CHAT_API_URL}/api/notifications/send`, workingNotification);
    console.log('📊 Resultado:', {
      success: response1.data.success,
      delivered: response1.data.results?.[0]?.delivered,
      notification: {
        id: response1.data.results?.[0]?.notification?.id,
        type: response1.data.results?.[0]?.notification?.type,
        title: response1.data.results?.[0]?.notification?.title
      }
    });
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }


  await new Promise(resolve => setTimeout(resolve, 3000));


  console.log('\n❌ TESTE 2: Notificação que NÃO FUNCIONA');
  const notWorkingNotification = {
    userIds: [USER_ID],
    notification: {
      id: `not_working_${Date.now()}`,
      title: 'Nova Proposta Recebida!',
      message: 'João enviou uma proposta de R$ 150,00 para seu boosting de League of Legends',
      type: 'new_proposal',
      link: '/boosting/123/proposals',
      image: 'https://via.placeholder.com/40',
      timestamp: new Date().toISOString(),
      isRead: false,
      relatedId: 'test_123',
      relatedType: 'BoostingRequest'
    },
    options: {
      persistent: true,
      retryOnFailure: true
    }
  };

  try {
    const response2 = await axios.post(`${CHAT_API_URL}/api/notifications/send`, notWorkingNotification);
    console.log('📊 Resultado:', {
      success: response2.data.success,
      delivered: response2.data.results?.[0]?.delivered,
      notification: {
        id: response2.data.results?.[0]?.notification?.id,
        type: response2.data.results?.[0]?.notification?.type,
        title: response2.data.results?.[0]?.notification?.title
      }
    });
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }


  await new Promise(resolve => setTimeout(resolve, 3000));


  console.log('\n🧪 TESTE 3: Mudando apenas o TYPE da notificação que funciona');
  const typeTestNotification = {
    userIds: [USER_ID],
    notification: {
      id: `type_test_${Date.now()}`,
      title: 'Notificação Direcionada (Type Alterado)',
      message: 'Mesma notificação, mas com type diferente!',
      type: 'new_proposal',
      priority: 'high',
      timestamp: new Date().toISOString(),
      isRead: false
    }
  };

  try {
    const response3 = await axios.post(`${CHAT_API_URL}/api/notifications/send`, typeTestNotification);
    console.log('📊 Resultado:', {
      success: response3.data.success,
      delivered: response3.data.results?.[0]?.delivered,
      notification: {
        id: response3.data.results?.[0]?.notification?.id,
        type: response3.data.results?.[0]?.notification?.type,
        title: response3.data.results?.[0]?.notification?.title
      }
    });
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }


  await new Promise(resolve => setTimeout(resolve, 3000));


  console.log('\n🧪 TESTE 4: Notificação limpa sem campos extras');
  const cleanNotification = {
    userIds: [USER_ID],
    notification: {
      id: `clean_${Date.now()}`,
      title: 'Nova Proposta (Limpa)',
      message: 'Proposta sem campos extras',
      type: 'new_proposal',
      timestamp: new Date().toISOString(),
      isRead: false
    }
  };
  try {
    const response4 = await axios.post(`${CHAT_API_URL}/api/notifications/send`, cleanNotification);
    console.log('📊 Resultado:', {
      success: response4.data.success,
      delivered: response4.data.results?.[0]?.delivered,
      notification: {
        id: response4.data.results?.[0]?.notification?.id,
        type: response4.data.results?.[0]?.notification?.type,
        title: response4.data.results?.[0]?.notification?.title
      }
    });
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }

  console.log('\n🔍 Análise:');
  console.log('1. Verifique no frontend quais notificações apareceram');
  console.log('2. Compare os campos entre as que funcionam e não funcionam');
  console.log('3. Verifique no console do navegador se há erros de processamento');
  console.log('4. Todas devem ter delivered: true se chegaram ao WebSocket');
}

debugNotifications();

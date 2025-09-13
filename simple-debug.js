/**
 * Debug simples para comparar notificações que funcionam vs não funcionam
 */

const axios = require('axios');

const CHAT_API_URL = 'https://zenith.enrelyugi.com.br/';
const USER_ID = '6897d82c8cdd40188e08a224';

async function testNotifications() {
  console.log('🔍 Debug simples das notificações...');
  
  console.log('\n📋 INSTRUÇÕES:');
  console.log('1. Abra o frontend no navegador');
  console.log('2. Abra o console (F12)');
  console.log('3. Observe as notificações que aparecem');
  
  console.log('\n🚀 Enviando notificações em sequência...');


  console.log('\n✅ TESTE 1: Notificação FUNCIONA');
  await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
    userIds: [USER_ID],
    notification: {
      id: `works_${Date.now()}`,
      title: 'FUNCIONA - Direcionada',
      message: 'Esta notificação aparece no frontend!',
      type: 'targeted_test',
      timestamp: new Date().toISOString(),
      isRead: false
    }
  });
  console.log('✅ Enviada: "FUNCIONA - Direcionada"');
  
  await new Promise(resolve => setTimeout(resolve, 3000));


  console.log('\n🧪 TESTE 2: Mesma notificação, type = new_proposal');
  await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
    userIds: [USER_ID],
    notification: {
      id: `type_test_${Date.now()}`,
      title: 'TESTE TYPE - Direcionada',
      message: 'Esta notificação tem type new_proposal!',
      type: 'new_proposal',
      timestamp: new Date().toISOString(),
      isRead: false
    }
  });
  console.log('✅ Enviada: "TESTE TYPE - Direcionada"');
  
  await new Promise(resolve => setTimeout(resolve, 3000));


  console.log('\n📝 TESTE 3: Notificação formato completo');
  await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
    userIds: [USER_ID],
    notification: {
      id: `full_${Date.now()}`,
      title: 'FORMATO COMPLETO - Nova Proposta',
      message: 'Proposta com todos os campos!',
      type: 'new_proposal',
      link: '/boosting/123/proposals',
      image: 'https://via.placeholder.com/40',
      timestamp: new Date().toISOString(),
      isRead: false,
      relatedId: 'test_123',
      relatedType: 'BoostingRequest'
    }
  });
  console.log('✅ Enviada: "FORMATO COMPLETO - Nova Proposta"');
  
  await new Promise(resolve => setTimeout(resolve, 3000));


  const types = ['proposal_accepted', 'new_boosting', 'boosting_completed'];
  
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    console.log(`\n🎯 TESTE ${4 + i}: Type = ${type}`);
    
    await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [USER_ID],
      notification: {
        id: `${type}_${Date.now()}`,
        title: `TESTE ${type.toUpperCase()}`,
        message: `Notificação do tipo ${type}`,
        type: type,
        timestamp: new Date().toISOString(),
        isRead: false
      }
    });
    console.log(`✅ Enviada: "TESTE ${type.toUpperCase()}"`);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n🔍 ANÁLISE:');
  console.log('Agora verifique no frontend:');
  console.log('1. Quantas notificações apareceram?');
  console.log('2. Quais tipos funcionaram?');
  console.log('3. Há algum padrão nos que não funcionam?');
  console.log('4. Verifique o console do navegador para erros');
}

testNotifications().catch(console.error);

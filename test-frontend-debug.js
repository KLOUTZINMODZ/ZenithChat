/**
 * Debug específico para verificar exatamente o que o frontend recebe
 */

const axios = require('axios');

const CHAT_API_URL = 'https://vast-beans-agree.loca.lt/';
const USER_ID = '6897d82c8cdd40188e08a224';

console.log('🔍 Debug específico do frontend...');

async function testFrontendReceiving() {
  console.log('\n📋 INSTRUÇÕES DE DEBUG:');
  console.log('1. Abra o console do navegador (F12)');
  console.log('2. Cole este código no console ANTES de executar este teste:');
  console.log(`

window.originalLog = console.log;
window.wsMessages = [];

console.log = function(...args) {
  if (args[0]?.includes?.('WS notification message:') || args[0]?.includes?.('🔔') || args[0]?.includes?.('✅')) {
    window.wsMessages.push({
      timestamp: new Date().toISOString(),
      message: args
    });
  }
  return window.originalLog.apply(console, args);
};

console.log('✅ Debug ativado. Aguardando notificações...');
  `);

  console.log('\n3. Aperte ENTER quando estiver pronto...');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    

    runTests();
  });
}

async function runTests() {
  console.log('\n🚀 Executando testes...\n');


  console.log('✅ TESTE 1: Enviando notificação que FUNCIONA');
  try {
    await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [USER_ID],
      notification: {
        id: `working_${Date.now()}`,
        title: 'Notificação Direcionada',
        message: 'Esta notificação FUNCIONA!',
        type: 'targeted_test',
        priority: 'high',
        timestamp: new Date().toISOString(),
        isRead: false
      }
    });
    console.log('✅ Enviada com sucesso!');
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }

  await new Promise(resolve => setTimeout(resolve, 2000));


  console.log('\n❌ TESTE 2: Enviando notificação que NÃO FUNCIONA');
  try {
    await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [USER_ID],
      notification: {
        id: `not_working_${Date.now()}`,
        title: 'Nova Proposta Recebida!',
        message: 'Esta notificação NÃO FUNCIONA!',
        type: 'new_proposal',
        link: '/boosting/123/proposals',
        image: 'https://via.placeholder.com/40',
        timestamp: new Date().toISOString(),
        isRead: false,
        relatedId: 'test_123',
        relatedType: 'BoostingRequest'
      }
    });
    console.log('✅ Enviada com sucesso!');
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }

  await new Promise(resolve => setTimeout(resolve, 2000));


  console.log('\n🧪 TESTE 3: Notificação que funciona, mas mudando o TYPE');
  try {
    await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [USER_ID],
      notification: {
        id: `type_change_${Date.now()}`,
        title: 'Notificação Direcionada (Type Mudado)',
        message: 'Esta deveria funcionar se não for problema de type!',
        type: 'new_proposal',
        priority: 'high',
        timestamp: new Date().toISOString(),
        isRead: false
      }
    });
    console.log('✅ Enviada com sucesso!');
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }

  console.log('\n🔍 ANÁLISE FINAL:');
  console.log('4. Agora no console do navegador, execute:');
  console.log(`
console.log('📊 MENSAGENS WEBSOCKET CAPTURADAS:', window.wsMessages);
console.log('📊 Total de mensagens:', window.wsMessages.length);


window.wsMessages.forEach((msg, index) => {
  console.log(\`Mensagem \${index + 1}:\`, msg.message);
});


console.log = window.originalLog;
  `);
  
  console.log('\n5. Compare:');
  console.log('   - Quantas mensagens WebSocket foram recebidas');
  console.log('   - Quais foram processadas (🔔 logs)');
  console.log('   - Quais apareceram na tela');
  console.log('\n6. Isso vai mostrar EXATAMENTE onde está o problema!');
}

testFrontendReceiving();

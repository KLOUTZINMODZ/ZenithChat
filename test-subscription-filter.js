/**
 * Teste específico para verificar se há filtragem baseada em subscription
 */

const axios = require('axios');

const CHAT_API_URL = 'https://zenith.enrelyugi.com.br/';
const USER_ID = '6897d82c8cdd40188e08a224';

async function testSubscriptionFilter() {
  console.log('🔍 Testando filtragem por subscription...');
  
  console.log('\n📋 INSTRUÇÕES:');
  console.log('1. Refresh o frontend para aplicar nova subscription');
  console.log('2. Aguarde conexão WebSocket');
  console.log('3. Verifique console do navegador');
  

  console.log('\n⏱️ Aguarde 5 segundos para refresh do frontend...');
  await new Promise(resolve => setTimeout(resolve, 5000));


  const subscriptionTypes = [
    'new_proposal',
    'proposal_accepted', 
    'new_boosting',
    'boosting_completed',
    'targeted_test'
  ];

  for (let i = 0; i < subscriptionTypes.length; i++) {
    const type = subscriptionTypes[i];
    
    console.log(`\n✅ TESTE ${i + 1}: Type = ${type} (NA SUBSCRIPTION)`);
    
    try {
      await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
        userIds: [USER_ID],
        notification: {
          id: `sub_${type}_${Date.now()}`,
          title: `Teste ${type.toUpperCase()}`,
          message: `Notificação do tipo ${type} que DEVE aparecer`,
          type: type,
          timestamp: new Date().toISOString(),
          isRead: false
        }
      });
      console.log(`✅ Enviada: ${type}`);
    } catch (error) {
      console.error(`❌ Erro enviando ${type}:`, error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }


  console.log(`\n❌ TESTE EXTRA: Type = unknown_type (NÃO NA SUBSCRIPTION)`);
  try {
    await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [USER_ID],
      notification: {
        id: `unknown_${Date.now()}`,
        title: 'Teste UNKNOWN TYPE',
        message: 'Este tipo NÃO está na subscription',
        type: 'unknown_type',
        timestamp: new Date().toISOString(),
        isRead: false
      }
    });
    console.log('✅ Enviada: unknown_type');
  } catch (error) {
    console.error('❌ Erro enviando unknown_type:', error.message);
  }

  console.log('\n🔍 RESULTADO ESPERADO:');
  console.log('- Os 5 primeiros tipos DEVEM aparecer (estão na subscription)');
  console.log('- O último tipo (unknown_type) NÃO deve aparecer');
  console.log('- Se ainda assim apenas targeted_test aparecer, há outro problema');
  
  console.log('\n📊 PRÓXIMO PASSO:');
  console.log('- Verifique quantas notificações apareceram no frontend');
  console.log('- Se todas apareceram: problema resolvido!');
  console.log('- Se só targeted_test: há filtragem adicional no backend');
  console.log('- Se nenhuma: problema na subscription');
}

testSubscriptionFilter().catch(console.error);

/**
 * Teste específico para o tipo 'new_boosting' que não está funcionando
 */

const axios = require('axios');

const CHAT_API_URL = 'https://12zku8.instatunnel.my/';
const USER_ID = '6897d82c8cdd40188e08a224';

async function testNewBoosting() {
  console.log('🎯 Teste específico para new_boosting...');

  // Teste 1: new_boosting simples
  console.log('\n🧪 TESTE 1: new_boosting básico');
  try {
    await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [USER_ID],
      notification: {
        id: `simple_boosting_${Date.now()}`,
        title: 'TESTE: Novo Boosting Simples',
        message: 'Este é um teste básico de new_boosting',
        type: 'new_boosting',
        timestamp: new Date().toISOString(),
        isRead: false
      }
    });
    console.log('✅ Enviado: new_boosting simples');
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }

  await new Promise(resolve => setTimeout(resolve, 3000));

  // Teste 2: new_boosting com campos extras (formato original)
  console.log('\n🧪 TESTE 2: new_boosting formato completo');
  try {
    await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [USER_ID],
      notification: {
        id: `full_boosting_${Date.now()}`,
        title: 'TESTE: Novo Boosting Completo',
        message: 'Novo pedido de boosting para **Counter-Strike** foi publicado: Prata → Ouro por R$ 80,00',
        type: 'new_boosting',
        link: '/boosting/789/proposals',
        image: 'https://via.placeholder.com/40',
        timestamp: new Date().toISOString(),
        isRead: false,
        relatedId: 'test_789',
        relatedType: 'BoostingRequest'
      }
    });
    console.log('✅ Enviado: new_boosting completo');
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }

  await new Promise(resolve => setTimeout(resolve, 3000));

  // Teste 3: Comparação com tipo que funciona
  console.log('\n✅ TESTE 3: new_proposal (que funciona)');
  try {
    await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [USER_ID],
      notification: {
        id: `working_proposal_${Date.now()}`,
        title: 'TESTE: Nova Proposta (Controle)',
        message: 'Esta deveria funcionar normalmente',
        type: 'new_proposal',
        timestamp: new Date().toISOString(),
        isRead: false
      }
    });
    console.log('✅ Enviado: new_proposal (controle)');
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }

  console.log('\n📊 RESULTADO ESPERADO:');
  console.log('- TESTE 1 e 2 (new_boosting): devem aparecer se não há problema específico');
  console.log('- TESTE 3 (new_proposal): deve aparecer como controle');
  console.log('\n🔍 Se new_boosting ainda não aparecer:');
  console.log('- Problema pode estar no processamento frontend do tipo new_boosting');
  console.log('- Ou filtro específico no backend para esse tipo');
}

testNewBoosting().catch(console.error);

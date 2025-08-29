/**
 * Teste final para new_boosting após corrigir as preferências
 */

const axios = require('axios');

const CHAT_API_URL = 'https://zenith.enrelyugi.com.br/';
const USER_ID = '6897d82c8cdd40188e08a224';

async function testRealNewBoosting() {
  console.log('🎯 Teste final: new_boosting após corrigir preferências...');
  
  console.log('\n📋 CERTIFIQUE-SE:');
  console.log('1. HackLoteAPI foi reiniciado');
  console.log('2. Frontend está conectado');
  console.log('3. Console do navegador está aberto');

  await new Promise(resolve => setTimeout(resolve, 2000));


  console.log('\n🧪 Enviando new_boosting real...');
  try {
    const response = await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
      userIds: [USER_ID],
      notification: {
        id: `real_boosting_${Date.now()}`,
        title: 'Novo Boosting Publicado!',
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

    if (response.data.success && response.data.results[0].delivered) {
      console.log('✅ Notificação new_boosting entregue via WebSocket!');
    } else {
      console.log('❌ Falha na entrega:', response.data);
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }

  console.log('\n📊 RESULTADO ESPERADO:');
  console.log('- Deve aparecer "Novo Boosting Publicado!" no frontend');
  console.log('- Como toast E na lista de notificações');
  console.log('- Console deve mostrar: 🔔 Nova notificação recebida');
  
  console.log('\n✅ Se apareceu: PROBLEMA 100% RESOLVIDO!');
  console.log('❌ Se não apareceu: ainda há filtro no backend ou frontend');
}

testRealNewBoosting().catch(console.error);

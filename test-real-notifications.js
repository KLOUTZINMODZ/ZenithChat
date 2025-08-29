/**
 * Teste para simular notificações reais do HackLoteAPI
 * (Proposta Aceita, Novo Boosting, etc.)
 */

const axios = require('axios');

const CHAT_API_URL = 'https://12zku8.instatunnel.my/';
const USER_ID = '6897d82c8cdd40188e08a224';

console.log('🧪 Testando notificações reais do HackLoteAPI...');

async function testRealNotifications() {
  const notifications = [
    {
      title: 'Nova Proposta Recebida!',
      message: 'João enviou uma proposta de R$ 150,00 para seu boosting de League of Legends',
      type: 'new_proposal',
      link: '/boosting/123/proposals',
      image: 'https://via.placeholder.com/40'
    },
    {
      title: 'Proposta Aceita!',
      message: 'Maria aceitou sua proposta de R$ 200,00 para o boosting de Valorant',
      type: 'proposal_accepted',
      link: '/boosting/456/proposals',
      image: 'https://via.placeholder.com/40'
    },
    {
      title: 'Novo Boosting Publicado!',
      message: 'Novo pedido de boosting para **Counter-Strike** foi publicado: Prata → Ouro por R$ 80,00',
      type: 'new_boosting',
      link: '/boosting/789/proposals',
      image: 'https://via.placeholder.com/40'
    },
    {
      title: 'Boosting Completo!',
      message: 'Seu boosting de Rocket League foi finalizado com sucesso!',
      type: 'boosting_completed',
      link: '/orders/101',
      image: 'https://via.placeholder.com/40'
    }
  ];

  for (let i = 0; i < notifications.length; i++) {
    const notif = notifications[i];
    console.log(`\n📨 Enviando ${i + 1}/${notifications.length}: ${notif.title}`);
    
    try {
      const response = await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
        userIds: [USER_ID],
        notification: {
          id: `real_${Date.now()}_${i}`,
          ...notif,
          timestamp: new Date().toISOString(),
          isRead: false,
          relatedId: `test_${i}`,
          relatedType: 'BoostingRequest'
        },
        options: {
          persistent: true,
          retryOnFailure: true
        }
      });

      const result = response.data.results?.[0];
      if (result?.delivered) {
        console.log('✅ Entregue via WebSocket em tempo real!');
      } else {
        console.log('⚠️ Enviada mas não entregue (usuário offline?)');
      }

    } catch (error) {
      console.error('❌ Erro:', error.response?.data?.message || error.message);
    }


    if (i < notifications.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n🎯 Verificações:');
  console.log('1. As 4 notificações devem ter aparecido no frontend');
  console.log('2. Verifique se têm os tipos corretos (new_proposal, proposal_accepted, etc.)');
  console.log('3. Devem aparecer como toasts e na lista de notificações');
}

testRealNotifications();

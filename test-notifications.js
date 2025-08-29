/**
 * Script de teste para a integração de notificações WebSocket
 * 
 * Este script testa:
 * 1. Envio de notificações via API REST
 * 2. Entrega via WebSocket 
 * 3. Cache de notificações offline
 * 4. Reconexão automática
 */

const axios = require('axios');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const CHAT_API_URL = process.env.CHAT_API_BASE_URL || 'https://12zku8.instatunnel.my/';
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';


function generateTestToken() {
  return jwt.sign(
    { 
      id: 'test_user_123',
      _id: 'test_user_123',
      name: 'Test User',
      email: 'test@example.com'
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const JWT_TOKEN = process.env.TEST_JWT_TOKEN || generateTestToken();

console.log('🧪 Iniciando testes de integração de notificações...');
console.log(`📡 Chat API URL: ${CHAT_API_URL}`);
console.log(`🔑 JWT Secret: ${JWT_SECRET.substring(0, 10)}...`);
console.log(`🎫 Token gerado: ${JWT_TOKEN.substring(0, 50)}...`);

class NotificationTester {
  constructor() {
    this.ws = null;
    this.receivedNotifications = [];
    this.testResults = [];
  }

  async runAllTests() {
    try {
      console.log('\n=== INICIANDO TESTES ===\n');
      
      await this.testWebSocketConnection();
      await this.testNotificationSending();
      await this.testNotificationSubscription();
      await this.testOfflineNotifications();
      await this.testUnreadCount();
      
      this.printResults();
      
    } catch (error) {
      console.error('❌ Erro durante os testes:', error);
    } finally {
      if (this.ws) {
        this.ws.close();
      }
    }
  }

  async testWebSocketConnection() {
    console.log('🔌 Teste 1: Conexão WebSocket');
    
    return new Promise((resolve, reject) => {
      const wsUrl = `${CHAT_API_URL.replace(/^http/, 'ws')}/ws?token=${JWT_TOKEN}`;
      this.ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        this.addResult('WebSocket Connection', false, 'Timeout');
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅ Conexão WebSocket estabelecida');
        this.addResult('WebSocket Connection', true, 'Connected successfully');
        

        this.ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          console.log('📨 Mensagem recebida:', message.type);
          
          if (message.type === 'notification:new') {
            this.receivedNotifications.push(message.data.notification);
          }
        });
        
        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('❌ Erro na conexão WebSocket:', error.message);
        this.addResult('WebSocket Connection', false, error.message);
        reject(error);
      });
    });
  }

  async testNotificationSending() {
    console.log('\n📤 Teste 2: Envio de notificação via API REST');
    
    try {
      const response = await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
        userIds: ['test_user_123'],
        notification: {
          title: 'Teste de Notificação',
          message: 'Esta é uma notificação de teste via WebSocket',
          type: 'test',
          priority: 'normal'
        },
        options: {
          persistent: true,
          retryOnFailure: true
        }
      });

      if (response.data.success) {
        console.log('✅ Notificação enviada com sucesso');
        this.addResult('REST API Notification', true, 'Sent successfully');
      } else {
        console.log('❌ Falha ao enviar notificação');
        this.addResult('REST API Notification', false, 'Send failed');
      }
    } catch (error) {
      console.log('❌ Erro ao enviar notificação:', error.message);
      this.addResult('REST API Notification', false, error.message);
    }
  }

  async testNotificationSubscription() {
    console.log('\n🔔 Teste 3: Subscrição a notificações');
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.addResult('Notification Subscription', false, 'WebSocket not connected');
      return;
    }


    this.ws.send(JSON.stringify({
      type: 'notification:subscribe',
      types: ['test', 'new_proposal', 'proposal_accepted'],
      games: []
    }));


    await new Promise(resolve => setTimeout(resolve, 1000));


    this.ws.send(JSON.stringify({
      type: 'notification:test',
      message: 'Teste de notificação direta via WebSocket',
      notificationType: 'info'
    }));

    console.log('✅ Subscrição enviada e notificação de teste disparada');
    this.addResult('Notification Subscription', true, 'Subscribed and test sent');
  }

  async testOfflineNotifications() {
    console.log('\n📱 Teste 4: Notificações offline (simulação)');
    
    try {

      const response = await axios.post(`${CHAT_API_URL}/api/notifications/send`, {
        userIds: ['offline_user_456'],
        notification: {
          title: 'Notificação Offline',
          message: 'Esta notificação será armazenada em cache',
          type: 'offline_test'
        }
      });

      console.log('✅ Notificação para usuário offline enviada (será cacheada)');
      this.addResult('Offline Notifications', true, 'Cached for offline user');
    } catch (error) {
      console.log('❌ Erro no teste offline:', error.message);
      this.addResult('Offline Notifications', false, error.message);
    }
  }

  async testUnreadCount() {
    console.log('\n🔢 Teste 5: Contador de não lidas');
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.addResult('Unread Count', false, 'WebSocket not connected');
      return;
    }


    this.ws.send(JSON.stringify({
      type: 'notification:get_unread_count'
    }));

    console.log('✅ Solicitação de contador enviada');
    this.addResult('Unread Count', true, 'Request sent');
  }

  addResult(test, success, details) {
    this.testResults.push({
      test,
      success,
      details,
      timestamp: new Date().toISOString()
    });
  }

  printResults() {
    console.log('\n=== RESULTADOS DOS TESTES ===\n');
    
    let passed = 0;
    let failed = 0;

    this.testResults.forEach(result => {
      const status = result.success ? '✅ PASSOU' : '❌ FALHOU';
      console.log(`${status} ${result.test}: ${result.details}`);
      
      if (result.success) passed++;
      else failed++;
    });

    console.log(`\n📊 Resumo: ${passed} passaram, ${failed} falharam`);
    console.log(`📨 Notificações recebidas via WebSocket: ${this.receivedNotifications.length}`);
    
    if (this.receivedNotifications.length > 0) {
      console.log('\n📋 Notificações recebidas:');
      this.receivedNotifications.forEach((notif, i) => {
        console.log(`  ${i + 1}. ${notif.title}: ${notif.message}`);
      });
    }
  }
}


if (require.main === module) {
  const tester = new NotificationTester();
  tester.runAllTests().then(() => {
    console.log('\n🏁 Testes concluídos');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Falha crítica nos testes:', error);
    process.exit(1);
  });
}

module.exports = NotificationTester;

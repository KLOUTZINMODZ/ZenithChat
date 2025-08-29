const axios = require('axios');


const WEBHOOK_URL = 'https://12zku8.instatunnel.my/api/marketplace-webhook/mercadopago-webhook';
const API_BASE_URL = 'https://12zku8.instatunnel.my';


async function testWebhookFormats() {
  console.log('🧪 Testing Mercado Pago Webhook Formats...\n');
  

  console.log('📝 Test 1: Query string format');
  try {
    const response1 = await axios.post(
      `${WEBHOOK_URL}?type=payment&data.id=122930854647`,
      {},
      { timeout: 10000 }
    );
    console.log('✅ Response:', response1.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n📝 Test 2: Body format');
  try {
    const response2 = await axios.post(
      WEBHOOK_URL,
      {
        type: 'payment',
        data: { id: '122930854647' }
      },
      { timeout: 10000 }
    );
    console.log('✅ Response:', response2.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n📝 Test 3: Alternative URL params format');
  try {
    const response3 = await axios.post(
      `${WEBHOOK_URL}?id=122930854647&topic=payment`,
      {},
      { timeout: 10000 }
    );
    console.log('✅ Response:', response3.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
}


async function testRealPayment() {
  console.log('\n🔍 Testing with real payment data...\n');
  
  try {
    const response = await axios.post(
      WEBHOOK_URL,
      {
        type: 'payment',
        data: { 
          id: '122930854647'
        }
      },
      { timeout: 15000 }
    );
    
    console.log('✅ Webhook processed successfully!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Error processing webhook:', error.response?.data || error.message);
  }
}


async function checkHealth() {
  console.log('\n🏥 Checking webhook service health...\n');
  
  try {
    const response = await axios.get(`${API_BASE_URL}/api/marketplace-webhook/health`);
    console.log('✅ Service Health:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
  }
}


async function main() {
  console.log('='.repeat(50));
  console.log('   MERCADO PAGO WEBHOOK TEST SUITE');
  console.log('='.repeat(50));
  
  await checkHealth();
  await testWebhookFormats();
  await testRealPayment();
  
  console.log('\n' + '='.repeat(50));
  console.log('   TEST COMPLETE');
  console.log('='.repeat(50));
}


main().catch(console.error);

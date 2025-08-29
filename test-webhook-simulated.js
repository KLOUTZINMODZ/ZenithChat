const axios = require('axios');


async function testSimulatedPayment() {
  console.log('🧪 Testing Webhook with Simulated Payment\n');
  

  const userId = '1115808594';
  const timestamp = Date.now();
  const externalReference = `marketplace_highlight_${userId}_${timestamp}`;
  
  console.log('📝 Test Configuration:');
  console.log(`  - User ID: ${userId}`);
  console.log(`  - External Reference: ${externalReference}`);
  console.log('');
  

  try {
    console.log('1️⃣ Testing with /test-webhook endpoint...');
    const testResponse = await axios.post(
      'https://zenith.enrelyugi.com.br/api/marketplace-webhook/test-webhook',
      {
        userId: userId,
        paymentId: `test_payment_${timestamp}`,
        status: 'approved'
      },
      { timeout: 10000 }
    );
    
    console.log('✅ Test webhook response:', JSON.stringify(testResponse.data, null, 2));
  } catch (error) {
    console.log('❌ Test webhook error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  

  try {
    console.log('2️⃣ Testing with actual webhook endpoint...');
    console.log('   Simulating Mercado Pago notification format');
    

    const webhookUrl = `https://zenith.enrelyugi.com.br/api/marketplace-webhook/mercadopago-webhook`;
    const paymentId = '122930854647';
    
    const response = await axios.post(
      `${webhookUrl}?type=payment&data.id=${paymentId}`,
      {},
      { timeout: 10000 }
    );
    
    console.log('✅ Webhook response:', JSON.stringify(response.data, null, 2));
    

    if (response.data.success) {
      console.log('\n🎉 Payment webhook processed successfully!');
      if (response.data.data) {
        console.log('   Highlight details:', response.data.data);
      }
    } else {
      console.log('\n⚠️ Webhook processed but encountered issues');
      console.log('   Message:', response.data.message);
    }
  } catch (error) {
    console.log('❌ Webhook error:', error.response?.data || error.message);
  }
}


async function main() {
  console.log('='.repeat(50));
  console.log('   MERCADO PAGO WEBHOOK SIMULATION TEST');
  console.log('='.repeat(50) + '\n');
  
  await testSimulatedPayment();
  
  console.log('\n' + '='.repeat(50));
  console.log('   TEST COMPLETE');
  console.log('='.repeat(50));
}


main().catch(console.error);

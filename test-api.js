// Test script for HackLote Chat API
// Run this with: node test-api.js

const axios = require('axios');

const API_URL = 'http://12zku8.instatunnel.my';

// Replace with a valid JWT token from your main API
const JWT_TOKEN = 'YOUR_JWT_TOKEN_HERE';

async function testHealthCheck() {
  try {
    console.log('1. Testing Health Check...');
    const response = await axios.get(`${API_URL}/health`);
    console.log('✅ Health Check:', response.data);
  } catch (error) {
    console.error('❌ Health Check failed:', error.message);
  }
}

async function testAuthValidation() {
  try {
    console.log('\n2. Testing Auth Validation...');
    const response = await axios.post(
      `${API_URL}/api/auth/validate`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${JWT_TOKEN}`
        }
      }
    );
    console.log('✅ Auth Validation:', response.data);
  } catch (error) {
    console.error('❌ Auth Validation failed:', error.response?.data || error.message);
  }
}

async function testWebSocketInfo() {
  try {
    console.log('\n3. Testing WebSocket Connection Info...');
    const response = await axios.get(
      `${API_URL}/api/auth/ws-token`,
      {
        headers: {
          'Authorization': `Bearer ${JWT_TOKEN}`
        }
      }
    );
    console.log('✅ WebSocket Info:', response.data);
  } catch (error) {
    console.error('❌ WebSocket Info failed:', error.response?.data || error.message);
  }
}

async function runTests() {
  console.log('🧪 Starting Chat API Tests\n');
  console.log('API URL:', API_URL);
  console.log('----------------------------\n');
  
  await testHealthCheck();
  
  if (JWT_TOKEN === 'YOUR_JWT_TOKEN_HERE') {
    console.log('\n⚠️  Please update JWT_TOKEN with a valid token from your main API to test authenticated endpoints');
    console.log('You can get a token by logging into your main application');
  } else {
    await testAuthValidation();
    await testWebSocketInfo();
  }
  
  console.log('\n✅ Tests completed!');
}

runTests();

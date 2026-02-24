/**
 * Test Script for Promo Codes
 * Run: node scripts/test-promo-codes.js
 */
const axios = require('axios');

const API_URL = 'http://localhost:3000'; // Adjust as needed
const ADMIN_KEY = 'your_admin_key_here'; // Must match process.env.ADMIN_API_KEY
const USER_TOKEN = 'your_user_token_here'; // Get from a logged-in user

async function test() {
    try {
        console.log('--- Testing Promo Code System ---');

        // 1. Create a code
        console.log('\nCreating promo code...');
        const createRes = await axios.post(`${API_URL}/api/promo-codes/admin`, {
            code: 'TEST20',
            type: 'fixed',
            value: 20,
            description: 'Test code'
        }, {
            headers: { 'x-admin-key': ADMIN_KEY }
        });
        console.log('Create Result:', createRes.data);

        // 2. Redeem the code
        console.log('\nRedeeming promo code...');
        const redeemRes = await axios.post(`${API_URL}/api/promo-codes/redeem`, {
            code: 'TEST20',
            cpfCnpj: '12345678901' // Use a valid test CPF
        }, {
            headers: { 'Authorization': `Bearer ${USER_TOKEN}` }
        });
        console.log('Redeem Result:', redeemRes.data);

    } catch (error) {
        console.error('Error during testing:', error.response?.data || error.message);
    }
}

// test(); 
console.log('Script updated. Configure ADMIN_KEY and USER_TOKEN before running.');

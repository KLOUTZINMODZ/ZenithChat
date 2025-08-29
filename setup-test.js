/**
 * Script para configurar e executar testes de notificação
 * Resolve problemas de JWT_SECRET e configuração
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Configurando ambiente de teste...');


const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

let envContent = '';

if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
  console.log('✅ Arquivo .env encontrado');
} else if (fs.existsSync(envExamplePath)) {
  envContent = fs.readFileSync(envExamplePath, 'utf8');
  console.log('📋 Usando .env.example como base');
  

  fs.writeFileSync(envPath, envContent);
  console.log('✅ Arquivo .env criado');
} else {
  console.log('❌ Nenhum arquivo de configuração encontrado');
  process.exit(1);
}


if (!envContent.includes('JWT_SECRET=') || envContent.includes('JWT_SECRET=your_jwt_secret_here')) {
  console.log('🔑 Configurando JWT_SECRET para testes...');
  

  const testSecret = 'test_jwt_secret_for_notifications_' + Date.now();
  
  if (envContent.includes('JWT_SECRET=')) {
    envContent = envContent.replace(/JWT_SECRET=.*$/m, `JWT_SECRET=${testSecret}`);
  } else {
    envContent += `\nJWT_SECRET=${testSecret}\n`;
  }
  
  fs.writeFileSync(envPath, envContent);
  console.log('✅ JWT_SECRET configurado para testes');
}


require('dotenv').config();

console.log('🧪 Executando testes...');


const NotificationTester = require('./test-notifications');
const tester = new NotificationTester();

tester.runAllTests().then(() => {
  console.log('\n🏁 Testes concluídos');
  process.exit(0);
}).catch(error => {
  console.error('💥 Falha crítica nos testes:', error.message);
  process.exit(1);
});

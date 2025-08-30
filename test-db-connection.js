// Teste específico da conexão com MongoDB
require('dotenv').config();
const mongoose = require('mongoose');

console.log('🧪 Testando conexão MongoDB...');
console.log('URI:', process.env.MONGODB_URI ? 'Configurada' : 'Não configurada');

async function testConnection() {
  try {
    console.log('⏳ Tentando conectar...');
    
    // Timeout mais curto para teste
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // 5 segundos
      connectTimeoutMS: 5000,
      socketTimeoutMS: 5000
    });
    
    console.log('✅ MongoDB conectado:', conn.connection.host);
    console.log('📊 Estado da conexão:', conn.connection.readyState);
    
    await mongoose.connection.close();
    console.log('🔌 Conexão fechada');
    
  } catch (error) {
    console.log('❌ Erro de conexão:', error.message);
    
    if (error.name === 'MongoServerSelectionError') {
      console.log('🔍 Problema: Não conseguiu conectar ao servidor MongoDB');
      console.log('💡 Possíveis causas:');
      console.log('   - URI incorreta');
      console.log('   - Problema de rede');
      console.log('   - Servidor MongoDB indisponível');
    }
  }
}

testConnection();

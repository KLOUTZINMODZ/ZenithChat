// Teste mínimo do servidor sem dependências externas
require('dotenv').config();
const express = require('express');
const http = require('http');

console.log('🧪 Testando servidor mínimo...');

const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => {
  res.json({ message: 'Servidor funcionando', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
  
  // Auto-fechar após 3 segundos para teste
  setTimeout(() => {
    console.log('🔌 Fechando servidor de teste...');
    server.close();
    process.exit(0);
  }, 3000);
});

server.on('error', (error) => {
  console.log('❌ Erro no servidor:', error.message);
  process.exit(1);
});

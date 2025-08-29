const redis = require('redis');
require('dotenv').config();

async function testRedisConnection() {
  console.log('🔧 Testando conexão Redis Cloud...');
  console.log(`📍 Host: ${process.env.REDIS_HOST}`);
  console.log(`🔌 Port: ${process.env.REDIS_PORT}`);
  console.log(`👤 Username: ${process.env.REDIS_USERNAME}`);
  console.log(`🔐 Password: ${process.env.REDIS_PASSWORD ? '***configurada***' : 'não configurada'}`);
  
  const client = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT) || 6379,
      connectTimeout: 10000,
    },
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD || undefined,
  });

  client.on('error', (err) => {
    console.error('❌ Erro Redis:', err.message);
  });

  client.on('connect', () => {
    console.log('🟡 Conectando ao Redis...');
  });

  client.on('ready', () => {
    console.log('✅ Redis conectado e pronto!');
  });

  try {
    await client.connect();
    

    await client.set('test_key', 'HackLote Redis Test');
    const value = await client.get('test_key');
    
    console.log('🧪 Teste de escrita/leitura:');
    console.log(`   Valor escrito: "HackLote Redis Test"`);
    console.log(`   Valor lido: "${value}"`);
    
    if (value === 'HackLote Redis Test') {
      console.log('✅ Teste de cache bem-sucedido!');
    } else {
      console.log('❌ Teste de cache falhou!');
    }
    

    await client.del('test_key');
    

    await client.lPush('test_chat_messages', JSON.stringify({
      id: 'test123',
      message: 'Mensagem de teste',
      timestamp: new Date().toISOString()
    }));
    
    const messages = await client.lRange('test_chat_messages', 0, -1);
    console.log('📝 Teste de lista de mensagens:');
    console.log(`   Mensagens na lista: ${messages.length}`);
    

    await client.del('test_chat_messages');
    
    console.log('🎉 Todos os testes passaram! Redis Cloud configurado corretamente.');
    
  } catch (error) {
    console.error('❌ Erro na conexão Redis:', error.message);
    console.log('\n🔍 Possíveis soluções:');
    console.log('1. Verifique se as credenciais estão corretas no .env');
    console.log('2. Confirme se o Redis Cloud está ativo');
    console.log('3. Verifique se o IP está na whitelist do Redis Cloud');
    console.log('4. Teste a conexão com: redis-cli -u redis://default:password@host:port');
  } finally {
    await client.quit();
    console.log('🔚 Conexão fechada.');
  }
}

testRedisConnection();

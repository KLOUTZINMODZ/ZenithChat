/**
 * Script para testar o sistema de banimento
 * 
 * Uso:
 * node test-ban-user.js <userId> [motivo] [duracao_em_dias]
 * 
 * Exemplos:
 * node test-ban-user.js 67854d3a2f1e8b001c8f7e9b
 * node test-ban-user.js 67854d3a2f1e8b001c8f7e9b "Spam" 7
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function banUser(userId, reason = 'Teste de banimento', duration = null) {
  try {
    // Conectar ao banco
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');

    // Buscar usuário
    const user = await User.findById(userId);
    
    if (!user) {
      console.error('❌ Usuário não encontrado:', userId);
      process.exit(1);
    }

    console.log('\n📋 Usuário encontrado:');
    console.log('  - ID:', user._id);
    console.log('  - Nome:', user.name);
    console.log('  - Email:', user.email);
    console.log('  - Banido:', user.banned ? 'Sim' : 'Não');

    if (user.banned) {
      console.log('\n⚠️  Usuário já está banido!');
      console.log('  - Motivo:', user.bannedReason);
      console.log('  - Banido em:', user.bannedAt);
      console.log('  - Expira em:', user.bannedUntil || 'Permanente');
      
      const unban = await askQuestion('\nDeseja desbanir? (s/n): ');
      if (unban.toLowerCase() === 's') {
        await user.unbanUser();
        console.log('✅ Usuário desbanido com sucesso!');
      }
      
      await mongoose.disconnect();
      process.exit(0);
    }

    // Confirmar banimento
    console.log('\n🚫 Preparando para banir usuário...');
    console.log('  - Motivo:', reason);
    console.log('  - Duração:', duration ? `${duration} dias` : 'Permanente');
    
    const confirm = await askQuestion('\nConfirmar banimento? (s/n): ');
    
    if (confirm.toLowerCase() !== 's') {
      console.log('❌ Banimento cancelado');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Banir usuário
    await user.banUser(reason, null, duration);
    
    console.log('\n✅ Usuário banido com sucesso!');
    console.log('  - Banido em:', user.bannedAt);
    console.log('  - Motivo:', user.bannedReason);
    console.log('  - Expira em:', user.bannedUntil || 'Permanente');

    // Verificar se há servidor WebSocket rodando para desconectar
    console.log('\n⚠️  IMPORTANTE:');
    console.log('  - Se o usuário estiver conectado, ele será desconectado na próxima ação');
    console.log('  - Para desconectar imediatamente, reinicie o servidor ou use a API admin');

    await mongoose.disconnect();
    console.log('\n✅ Concluído!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Erro:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

function askQuestion(query) {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => readline.question(query, ans => {
    readline.close();
    resolve(ans);
  }));
}

// Processar argumentos
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('❌ Uso: node test-ban-user.js <userId> [motivo] [duracao_em_dias]');
  console.log('\nExemplos:');
  console.log('  node test-ban-user.js 67854d3a2f1e8b001c8f7e9b');
  console.log('  node test-ban-user.js 67854d3a2f1e8b001c8f7e9b "Spam"');
  console.log('  node test-ban-user.js 67854d3a2f1e8b001c8f7e9b "Violação dos termos" 7');
  process.exit(1);
}

const userId = args[0];
const reason = args[1] || 'Teste de banimento';
const duration = args[2] ? parseInt(args[2]) : null;

banUser(userId, reason, duration);

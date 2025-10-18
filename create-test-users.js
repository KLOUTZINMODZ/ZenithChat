/**
 * Script para Criar Usuários de Teste
 * 
 * Execute com: node create-test-users.js
 * 
 * Este script cria usuários de teste com diferentes valores de emailNotifications:
 * 1. Usuário com emailNotifications = true
 * 2. Usuário com emailNotifications = false
 * 3. Usuário com emailNotifications = undefined (sem definir)
 * 4. Usuário com emailNotifications = null
 * 5. Usuário sem objeto preferences
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Configuração do MongoDB (usa .env automaticamente)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zenith';

// Cores para console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

// Schema simplificado do usuário (deve corresponder ao seu modelo)
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  preferences: {
    emailNotifications: Boolean,
    sound: { type: Boolean, default: true },
    watchedGames: { type: [String], default: [] },
    watchedGameIds: { type: [Number], default: [] }
  },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Usuários de teste
const testUsers = [
  {
    name: 'Test User TRUE',
    email: 'test-true@zenith-test.com',
    password: 'test123',
    preferences: {
      emailNotifications: true,
      sound: true
    }
  },
  {
    name: '❌ Test User FALSE',
    email: 'test-false@zenith-test.com',
    password: 'test123',
    preferences: {
      emailNotifications: false,
      sound: true
    }
  },
  {
    name: '⚪ Test User UNDEFINED',
    email: 'test-undefined@zenith-test.com',
    password: 'test123',
    preferences: {
      // emailNotifications não definido (undefined)
      sound: true
    }
  },
  {
    name: '⚫ Test User NULL',
    email: 'test-null@zenith-test.com',
    password: 'test123',
    preferences: {
      emailNotifications: null,
      sound: true
    }
  },
  {
    name: '🚫 Test User NO PREFERENCES',
    email: 'test-noprefs@zenith-test.com',
    password: 'test123'
    // sem objeto preferences
  }
];

// Função para criar usuários
async function createTestUsers() {
  console.log(colors.cyan + '\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║          CRIAÇÃO DE USUÁRIOS DE TESTE                   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n' + colors.reset);

  try {
    // Conectar ao MongoDB
    console.log(colors.blue + '→ Conectando ao MongoDB...' + colors.reset);
    await mongoose.connect(MONGODB_URI);
    console.log(colors.green + '✓ Conectado ao MongoDB!\n' + colors.reset);

    // Remover usuários de teste antigos
    console.log(colors.yellow + '⚠ Removendo usuários de teste antigos...' + colors.reset);
    const deletedCount = await User.deleteMany({
      email: { $regex: '@zenith-test.com$' }
    });
    console.log(colors.green + `✓ Removidos ${deletedCount.deletedCount} usuários antigos\n` + colors.reset);

    // Criar novos usuários
    console.log(colors.blue + '→ Criando novos usuários de teste...\n' + colors.reset);

    for (const userData of testUsers) {
      const user = new User(userData);
      await user.save();
      
      // Buscar o usuário recém-criado para verificar o valor salvo
      const savedUser = await User.findById(user._id).lean();
      
      console.log(colors.cyan + `✓ Criado: ${userData.name}` + colors.reset);
      console.log(`  Email: ${userData.email}`);
      console.log(`  emailNotifications salvo como: ${colors.yellow}${savedUser.preferences?.emailNotifications}${colors.reset}`);
      console.log(`  Tipo: ${typeof savedUser.preferences?.emailNotifications}`);
      console.log('');
    }

    // Verificar criação
    console.log(colors.green + '\n✓ Todos os usuários de teste criados com sucesso!' + colors.reset);
    
    // Estatísticas
    const totalUsers = await User.countDocuments({});
    const testUsersCount = await User.countDocuments({
      email: { $regex: '@zenith-test.com$' }
    });
    
    console.log(colors.cyan + '\n📊 ESTATÍSTICAS:' + colors.reset);
    console.log(`  Total de usuários no banco: ${totalUsers}`);
    console.log(`  Usuários de teste: ${testUsersCount}`);

    // Análise detalhada dos usuários de teste
    console.log(colors.cyan + '\n🔍 ANÁLISE DETALHADA DOS USUÁRIOS DE TESTE:\n' + colors.reset);
    
    const allTestUsers = await User.find({
      email: { $regex: '@zenith-test.com$' }
    }).lean();

    allTestUsers.forEach((user, index) => {
      const hasPrefs = user.preferences && typeof user.preferences === 'object';
      const emailNotif = user.preferences?.emailNotifications;
      const isEligible = emailNotif === true;
      
      const statusIcon = isEligible ? '✅' : '❌';
      const statusColor = isEligible ? colors.green : colors.red;
      
      console.log(`${index + 1}. ${statusIcon} ${user.name}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Tem preferences: ${hasPrefs ? 'Sim' : 'Não'}`);
      console.log(`   emailNotifications: ${statusColor}${emailNotif}${colors.reset} (${typeof emailNotif})`);
      console.log(`   É elegível: ${isEligible ? colors.green + 'SIM' : colors.red + 'NÃO'}${colors.reset}`);
      console.log('');
    });

    // Instruções finais
    console.log(colors.cyan + '═'.repeat(60) + colors.reset);
    console.log(colors.yellow + '\n⚡ PRÓXIMOS PASSOS:' + colors.reset);
    console.log('  1. Execute: node test-email-system.js');
    console.log('  2. Verifique se os 5 usuários de teste aparecem corretamente');
    console.log('  3. Confirme que apenas o "Test User TRUE" é elegível');
    console.log('  4. Teste o envio de emails no painel admin\n');

  } catch (error) {
    console.error(colors.red + '✗ Erro:', error.message + colors.reset);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log(colors.blue + '→ Desconectado do MongoDB' + colors.reset);
  }
}

// Executar
createTestUsers().catch(error => {
  console.error(colors.red + 'Erro fatal:', error.message + colors.reset);
  process.exit(1);
});

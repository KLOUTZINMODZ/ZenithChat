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
  
  
  

  try {
    // Conectar ao MongoDB
    
    await mongoose.connect(MONGODB_URI);
    

    // Remover usuários de teste antigos
    
    const deletedCount = await User.deleteMany({
      email: { $regex: '@zenith-test.com$' }
    });
    

    // Criar novos usuários
    

    for (const userData of testUsers) {
      const user = new User(userData);
      await user.save();
      
      // Buscar o usuário recém-criado para verificar o valor salvo
      const savedUser = await User.findById(user._id).lean();
      
      
      
      
      
      
    }

    // Verificar criação
    
    
    // Estatísticas
    const totalUsers = await User.countDocuments({});
    const testUsersCount = await User.countDocuments({
      email: { $regex: '@zenith-test.com$' }
    });
    
    
    
    

    // Análise detalhada dos usuários de teste
    
    
    const allTestUsers = await User.find({
      email: { $regex: '@zenith-test.com$' }
    }).lean();

    allTestUsers.forEach((user, index) => {
      const hasPrefs = user.preferences && typeof user.preferences === 'object';
      const emailNotif = user.preferences?.emailNotifications;
      const isEligible = emailNotif === true;
      
      const statusIcon = isEligible ? '✅' : '❌';
      const statusColor = isEligible ? colors.green : colors.red;
      
      
      
      
      `);
      
      
    });

    // Instruções finais
    + colors.reset);
    
    
    
    
    

  } catch (error) {
    
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    
  }
}

// Executar
createTestUsers().catch(error => {
  
  process.exit(1);
});

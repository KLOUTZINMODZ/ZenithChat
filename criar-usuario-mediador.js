require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

async function criarUsuarioMediador() {
  try {
    console.log('🔍 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado!\n');

    const User = require('./src/models/User');

    // 1. Verificar se já existe
    const mediatorEmail = process.env.MEDIATOR_EMAIL || 'mediador@zenith.com';
    const existingUser = await User.findOne({ email: mediatorEmail });

    if (existingUser) {
      console.log('⚠️ Usuário mediador JÁ EXISTE!');
      console.log('  ID:', existingUser._id);
      console.log('  Email:', existingUser.email);
      console.log('  Nome:', existingUser.name);
      console.log('  Saldo:', `R$ ${(existingUser.walletBalance || 0).toFixed(2)}`);
      console.log('\n✅ Não é necessário criar novamente.');
      return;
    }

    // 2. Criar usuário mediador
    console.log('📝 Criando usuário mediador...');
    
    // Hash de senha simples (admin123)
    const passwordHash = await bcrypt.hash('admin123', 10);

    const mediadorUser = new User({
      email: mediatorEmail,
      name: 'Mediador Zenith',
      username: 'mediador',
      password: passwordHash,
      role: 'admin',
      walletBalance: 0,
      isActive: true,
      isVerified: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await mediadorUser.save();

    console.log('✅ USUÁRIO MEDIADOR CRIADO COM SUCESSO!');
    console.log('');
    console.log('📋 Detalhes:');
    console.log('  ID:', mediadorUser._id);
    console.log('  Email:', mediadorUser.email);
    console.log('  Nome:', mediadorUser.name);
    console.log('  Username:', mediadorUser.username);
    console.log('  Senha:', 'admin123');
    console.log('  Role:', mediadorUser.role);
    console.log('  Saldo inicial:', `R$ ${mediadorUser.walletBalance.toFixed(2)}`);
    console.log('');
    console.log('🔧 Próximos passos:');
    console.log('  1. Reiniciar Chat API: pm2 restart ZenithChat');
    console.log('  2. Confirmar entrega de boosting');
    console.log('  3. Verificar se taxa foi creditada');
    console.log('');

  } catch (error) {
    console.error('❌ Erro ao criar usuário:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

criarUsuarioMediador();

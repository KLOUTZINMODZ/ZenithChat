require('dotenv').config();
const mongoose = require('mongoose');

async function verificarDatabaseCompleto() {
  try {
    console.log('🔍 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado!\n');

    const db = mongoose.connection.db;

    // 1. Verificar nome do banco
    console.log('📊 INFORMAÇÕES DO BANCO DE DADOS:\n');
    console.log('  Nome do banco:', db.databaseName);
    console.log('  URI:', process.env.MONGODB_URI.replace(/\/\/.*@/, '//<credenciais>@'));
    console.log('');

    // 2. Listar todas as collections
    console.log('📋 COLLECTIONS DISPONÍVEIS:\n');
    const collections = await db.listCollections().toArray();
    
    for (const col of collections) {
      const count = await db.collection(col.name).countDocuments();
      console.log(`  - ${col.name} (${count} documentos)`);
    }
    console.log('');

    // 3. Verificar collection Mediator
    const mediatorExists = collections.find(c => c.name === 'mediator');
    
    if (!mediatorExists) {
      console.log('❌ Collection "mediator" NÃO EXISTE!\n');
      console.log('⚠️ O marketplace pode estar usando outro banco de dados ou collection.\n');
    } else {
      console.log('✅ Collection "mediator" encontrada!\n');
      
      // Buscar QUALQUER documento
      const anyDoc = await db.collection('mediator').findOne({});
      
      if (anyDoc) {
        console.log('📄 EXEMPLO DE DOCUMENTO:\n');
        console.log(JSON.stringify(anyDoc, null, 2));
        console.log('');
      } else {
        console.log('⚠️ Collection "mediator" está VAZIA!\n');
      }
    }

    // 4. Verificar WalletLedgers
    const walletLedgersExists = collections.find(c => c.name === 'walletledgers');
    
    if (walletLedgersExists) {
      console.log('📊 WALLETLEDGERS:\n');
      
      const reasons = await db.collection('walletledgers').distinct('reason');
      console.log('  Tipos de reason encontrados:', reasons);
      console.log('');
      
      // Contar por reason
      for (const reason of reasons) {
        const count = await db.collection('walletledgers').countDocuments({ reason });
        console.log(`    - ${reason}: ${count} registros`);
      }
      console.log('');
    }

    // 5. Verificar Users
    const usersExists = collections.find(c => c.name === 'users');
    
    if (usersExists) {
      const totalUsers = await db.collection('users').countDocuments();
      console.log(`👥 USERS: ${totalUsers} usuários\n`);
      
      // Buscar usuários com role admin
      const admins = await db.collection('users').find({ 
        role: 'admin' 
      }, { 
        projection: { email: 1, name: 1, walletBalance: 1 } 
      }).limit(5).toArray();
      
      if (admins.length > 0) {
        console.log('👑 USUÁRIOS ADMIN (possíveis mediadores):\n');
        admins.forEach(admin => {
          console.log(`  - ${admin.email} (${admin.name})`);
          console.log(`    ID: ${admin._id}`);
          console.log(`    Saldo: R$ ${(admin.walletBalance || 0).toFixed(2)}`);
          console.log('');
        });
      }
      
      // Buscar usuários com maior saldo (pode ser o mediador)
      const richUsers = await db.collection('users').find({}).sort({ 
        walletBalance: -1 
      }).limit(5).toArray();
      
      console.log('💰 USUÁRIOS COM MAIOR SALDO:\n');
      richUsers.forEach(user => {
        console.log(`  - ${user.email} (${user.name})`);
        console.log(`    ID: ${user._id}`);
        console.log(`    Saldo: R$ ${(user.walletBalance || 0).toFixed(2)}`);
        console.log(`    Role: ${user.role || 'N/A'}`);
        console.log('');
      });
    }

    // 6. Sugestão
    console.log('💡 SUGESTÃO:\n');
    console.log('Como não há taxas registradas no sistema atual, você tem 2 opções:\n');
    console.log('1️⃣ CRIAR um novo usuário mediador:');
    console.log('   node criar-usuario-mediador.js\n');
    console.log('2️⃣ USAR um usuário admin existente:');
    console.log('   Escolha um dos usuários admin listados acima');
    console.log('   e configure MEDIATOR_EMAIL no .env\n');
    console.log('Depois disso, tanto marketplace quanto boosting');
    console.log('vão começar a creditar taxas nesse usuário.\n');

  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Verificação concluída!');
    process.exit(0);
  }
}

verificarDatabaseCompleto();

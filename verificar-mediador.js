require('dotenv').config();
const mongoose = require('mongoose');

async function verificarMediador() {
  try {
    console.log('🔍 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado!\n');

    const User = require('./src/models/User');
    const WalletLedger = require('./src/models/WalletLedger');
    const Mediator = require('./src/models/Mediator');

    // 1. Verificar variáveis de ambiente
    console.log('📋 VARIÁVEIS DE AMBIENTE:');
    console.log('  MEDIATOR_USER_ID:', process.env.MEDIATOR_USER_ID || '❌ NÃO CONFIGURADO');
    console.log('  MEDIATOR_EMAIL:', process.env.MEDIATOR_EMAIL || '❌ NÃO CONFIGURADO');
    console.log('  Fallback email:', 'mediador@zenith.com');
    console.log('');

    // 2. Buscar usuário mediador
    const mediatorEmail = process.env.MEDIATOR_EMAIL || 'mediador@zenith.com';
    console.log(`🔍 Buscando usuário com email: ${mediatorEmail}`);
    
    const mediatorUser = await User.findOne({ email: mediatorEmail });
    
    if (!mediatorUser) {
      console.log('❌ USUÁRIO MEDIADOR NÃO ENCONTRADO!');
      console.log('');
      
      // Listar usuários com emails similares
      console.log('📋 Buscando usuários com emails similares...');
      const similarUsers = await User.find({ 
        email: { $regex: 'mediador', $options: 'i' } 
      }, { email: 1, name: 1, _id: 1, walletBalance: 1 }).limit(5);
      
      if (similarUsers.length > 0) {
        console.log('Encontrados:', similarUsers.length);
        similarUsers.forEach(u => {
          console.log(`  - ID: ${u._id}`);
          console.log(`    Email: ${u.email}`);
          console.log(`    Nome: ${u.name}`);
          console.log(`    Saldo: R$ ${(u.walletBalance || 0).toFixed(2)}`);
          console.log('');
        });
      } else {
        console.log('❌ Nenhum usuário encontrado com "mediador" no email');
        console.log('');
        
        // Listar primeiros 10 usuários do banco
        console.log('📋 Listando primeiros 10 usuários do banco:');
        const allUsers = await User.find({}, { email: 1, name: 1, _id: 1, role: 1 }).limit(10);
        allUsers.forEach(u => {
          console.log(`  - ${u.email} (${u.name}) - Role: ${u.role || 'N/A'}`);
        });
      }
      
      console.log('');
      console.log('💡 SOLUÇÃO:');
      console.log('  1. Criar usuário mediador no banco:');
      console.log(`     db.users.insertOne({`);
      console.log(`       email: "${mediatorEmail}",`);
      console.log(`       name: "Mediador Zenith",`);
      console.log(`       username: "mediador",`);
      console.log(`       password: "$2b$10$hash...",`);
      console.log(`       role: "admin",`);
      console.log(`       walletBalance: 0,`);
      console.log(`       isActive: true,`);
      console.log(`       createdAt: new Date(),`);
      console.log(`       updatedAt: new Date()`);
      console.log(`     })`);
      console.log('');
      console.log('  2. OU atualizar MEDIATOR_EMAIL no .env com email de usuário existente');
      
    } else {
      console.log('✅ USUÁRIO MEDIADOR ENCONTRADO!');
      console.log('  ID:', mediatorUser._id);
      console.log('  Email:', mediatorUser.email);
      console.log('  Nome:', mediatorUser.name);
      console.log('  Saldo:', `R$ ${(mediatorUser.walletBalance || 0).toFixed(2)}`);
      console.log('  Role:', mediatorUser.role || 'N/A');
      console.log('  Ativo:', mediatorUser.isActive || false);
      console.log('');

      // 3. Verificar movimentações do mediador
      console.log('📊 MOVIMENTAÇÕES DO MEDIADOR (WalletLedger):');
      const ledgers = await WalletLedger.find({ 
        userId: mediatorUser._id 
      }).sort({ createdAt: -1 }).limit(5);
      
      console.log(`  Total encontrado: ${ledgers.length}`);
      if (ledgers.length > 0) {
        ledgers.forEach(l => {
          console.log(`  - ${l.createdAt.toISOString().split('T')[0]} | ${l.reason} | ${l.direction} | R$ ${l.amount.toFixed(2)}`);
        });
      } else {
        console.log('  ⚠️ Nenhuma movimentação encontrada');
      }
      console.log('');

      // 4. Verificar logs do Mediator
      console.log('📊 LOGS DO MEDIATOR (Auditoria):');
      const mediatorLogs = await Mediator.find({}).sort({ occurredAt: -1 }).limit(5);
      
      console.log(`  Total encontrado: ${mediatorLogs.length}`);
      if (mediatorLogs.length > 0) {
        mediatorLogs.forEach(m => {
          console.log(`  - ${m.occurredAt.toISOString().split('T')[0]} | ${m.eventType} | ${m.source} | R$ ${m.amount.toFixed(2)}`);
        });
      } else {
        console.log('  ⚠️ Nenhum log encontrado');
      }
      console.log('');

      // 5. Verificar boosting_fee especificamente
      console.log('🎮 TAXAS DE BOOSTING (boosting_fee):');
      const boostingFees = await WalletLedger.find({ 
        reason: 'boosting_fee'
      }).sort({ createdAt: -1 }).limit(3);
      
      console.log(`  Total encontrado: ${boostingFees.length}`);
      if (boostingFees.length > 0) {
        boostingFees.forEach(l => {
          console.log(`  - ${l.createdAt.toISOString()} | User: ${l.userId} | R$ ${l.amount.toFixed(2)}`);
        });
      } else {
        console.log('  ⚠️ Nenhuma taxa de boosting encontrada');
      }
      console.log('');

      // 6. Comparar com purchase_fee
      console.log('🛒 TAXAS DE MARKETPLACE (purchase_fee):');
      const purchaseFees = await WalletLedger.find({ 
        reason: 'purchase_fee'
      }).sort({ createdAt: -1 }).limit(3);
      
      console.log(`  Total encontrado: ${purchaseFees.length}`);
      if (purchaseFees.length > 0) {
        purchaseFees.forEach(l => {
          console.log(`  - ${l.createdAt.toISOString()} | User: ${l.userId} | R$ ${l.amount.toFixed(2)}`);
        });
      } else {
        console.log('  ⚠️ Nenhuma taxa de marketplace encontrada');
      }
    }

    console.log('');
    console.log('✅ Verificação concluída!');
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

verificarMediador();

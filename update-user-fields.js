require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function updateUserFields() {
  try {
    console.log('🔗 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');

    console.log('🔄 Atualizando campos de usuários...');
    
    // Atualiza todos os usuários que não têm os novos campos
    const result = await User.updateMany(
      {
        $or: [
          { rating: { $exists: false } },
          { totalBoosts: { $exists: false } },
          { completedBoosts: { $exists: false } },
          { totalOrders: { $exists: false } },
          { isVerified: { $exists: false } }
        ]
      },
      {
        $set: {
          rating: 0,
          totalBoosts: 0,
          completedBoosts: 0,
          totalOrders: 0,
          isVerified: false
        }
      }
    );

    console.log(`✅ ${result.modifiedCount} usuários atualizados com os novos campos`);
    console.log(`ℹ️  ${result.matchedCount} usuários encontrados no total`);

    // Busca alguns usuários para verificar
    const sampleUsers = await User.find({}).limit(5).select('name rating totalBoosts completedBoosts totalOrders isVerified');
    console.log('\n📊 Amostra de usuários atualizados:');
    sampleUsers.forEach(user => {
      console.log(`- ${user.name}: rating=${user.rating}, totalBoosts=${user.totalBoosts}, completedBoosts=${user.completedBoosts}, totalOrders=${user.totalOrders}, isVerified=${user.isVerified}`);
    });

    console.log('\n✅ Atualização concluída com sucesso!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao atualizar campos:', error);
    process.exit(1);
  }
}

updateUserFields();

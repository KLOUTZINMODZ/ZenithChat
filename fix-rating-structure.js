require('dotenv').config();
const mongoose = require('mongoose');

async function fixRatingStructure() {
  try {
    console.log('🔗 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    console.log('🔄 Verificando estrutura dos campos rating...');
    
    // Busca usuários com rating como número (estrutura incorreta)
    const usersWithNumberRating = await usersCollection.find({
      rating: { $type: 'number' }
    }).toArray();

    console.log(`📊 Encontrados ${usersWithNumberRating.length} usuários com rating como número`);

    if (usersWithNumberRating.length > 0) {
      console.log('\n🔧 Convertendo ratings de número para objeto...');
      
      for (const user of usersWithNumberRating) {
        const oldRating = user.rating || 0;
        
        // Converte para estrutura de objeto
        await usersCollection.updateOne(
          { _id: user._id },
          {
            $set: {
              rating: {
                average: oldRating,
                count: 0
              }
            }
          }
        );
        
        console.log(`✅ Convertido: ${user.name} - rating ${oldRating} → {average: ${oldRating}, count: 0}`);
      }
      
      console.log(`\n✅ ${usersWithNumberRating.length} usuários convertidos com sucesso!`);
    }

    // Busca usuários sem o campo rating
    const usersWithoutRating = await usersCollection.find({
      rating: { $exists: false }
    }).toArray();

    console.log(`\n📊 Encontrados ${usersWithoutRating.length} usuários sem campo rating`);

    if (usersWithoutRating.length > 0) {
      console.log('\n🔧 Adicionando campo rating...');
      
      await usersCollection.updateMany(
        { rating: { $exists: false } },
        {
          $set: {
            rating: {
              average: 0,
              count: 0
            }
          }
        }
      );
      
      console.log(`✅ ${usersWithoutRating.length} usuários atualizados com campo rating`);
    }

    // Verifica usuários com rating.average faltando
    const usersWithoutAverage = await usersCollection.find({
      'rating.average': { $exists: false },
      rating: { $exists: true, $type: 'object' }
    }).toArray();

    console.log(`\n📊 Encontrados ${usersWithoutAverage.length} usuários com rating sem average`);

    if (usersWithoutAverage.length > 0) {
      console.log('\n🔧 Adicionando rating.average...');
      
      await usersCollection.updateMany(
        {
          'rating.average': { $exists: false },
          rating: { $exists: true, $type: 'object' }
        },
        {
          $set: {
            'rating.average': 0,
            'rating.count': 0
          }
        }
      );
      
      console.log(`✅ ${usersWithoutAverage.length} usuários atualizados com rating.average`);
    }

    // Mostra estatísticas finais
    console.log('\n📊 Estatísticas finais:');
    const totalUsers = await usersCollection.countDocuments({});
    const usersWithCorrectRating = await usersCollection.countDocuments({
      'rating.average': { $exists: true },
      'rating.count': { $exists: true }
    });

    console.log(`- Total de usuários: ${totalUsers}`);
    console.log(`- Usuários com rating correto: ${usersWithCorrectRating}`);
    console.log(`- Porcentagem: ${((usersWithCorrectRating / totalUsers) * 100).toFixed(2)}%`);

    // Amostra de usuários
    console.log('\n📋 Amostra de usuários (primeiros 5):');
    const sampleUsers = await usersCollection.find({}).limit(5).toArray();
    sampleUsers.forEach(user => {
      console.log(`- ${user.name}:`);
      console.log(`  rating.average: ${user.rating?.average || 'N/A'}`);
      console.log(`  rating.count: ${user.rating?.count || 'N/A'}`);
    });

    console.log('\n✅ Correção concluída com sucesso!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao corrigir estrutura:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

fixRatingStructure();

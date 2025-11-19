
require('dotenv').config();
const mongoose = require('mongoose');
const Conversation = require('../src/models/Conversation');

async function migrateConversations() {
  try {
    console.log('🔧 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Conectado ao MongoDB\n');

    // 1. Buscar todas as conversas com emails
    console.log('🔍 Buscando conversas com emails...');
    const conversationsWithEmails = await Conversation.find({
      $or: [
        { 'client.email': { $exists: true } },
        { 'booster.email': { $exists: true } },
        { 'marketplace.buyer.email': { $exists: true } },
        { 'marketplace.seller.email': { $exists: true } }
      ]
    }).lean();

    console.log(`📊 Encontradas ${conversationsWithEmails.length} conversas com emails\n`);

    if (conversationsWithEmails.length === 0) {
      console.log('✅ Nenhuma conversa com email encontrada. Migração não necessária.');
      await mongoose.disconnect();
      return;
    }

    // 2. Remover emails usando updateMany
    console.log('🧹 Removendo emails das conversas...\n');

    const results = {
      client: 0,
      booster: 0,
      buyerMarketplace: 0,
      sellerMarketplace: 0
    };

    // Remover client.email
    const clientResult = await Conversation.updateMany(
      { 'client.email': { $exists: true } },
      { $unset: { 'client.email': '' } }
    );
    results.client = clientResult.modifiedCount;
    console.log(`✅ Removidos emails de ${results.client} client fields`);

    // Remover booster.email
    const boosterResult = await Conversation.updateMany(
      { 'booster.email': { $exists: true } },
      { $unset: { 'booster.email': '' } }
    );
    results.booster = boosterResult.modifiedCount;
    console.log(`✅ Removidos emails de ${results.booster} booster fields`);

    // Remover marketplace.buyer.email
    const buyerResult = await Conversation.updateMany(
      { 'marketplace.buyer.email': { $exists: true } },
      { $unset: { 'marketplace.buyer.email': '' } }
    );
    results.buyerMarketplace = buyerResult.modifiedCount;
    console.log(`✅ Removidos emails de ${results.buyerMarketplace} marketplace.buyer fields`);

    // Remover marketplace.seller.email
    const sellerResult = await Conversation.updateMany(
      { 'marketplace.seller.email': { $exists: true } },
      { $unset: { 'marketplace.seller.email': '' } }
    );
    results.sellerMarketplace = sellerResult.modifiedCount;
    console.log(`✅ Removidos emails de ${results.sellerMarketplace} marketplace.seller fields`);

    // 3. Verificar se a migração funcionou
    console.log('\n🔍 Verificando migração...');
    const remainingWithEmails = await Conversation.countDocuments({
      $or: [
        { 'client.email': { $exists: true } },
        { 'booster.email': { $exists: true } },
        { 'marketplace.buyer.email': { $exists: true } },
        { 'marketplace.seller.email': { $exists: true } }
      ]
    });

    if (remainingWithEmails === 0) {
      console.log('✅ Migração concluída com sucesso! Nenhum email remanescente.\n');
    } else {
      console.log(`⚠️ AVISO: ${remainingWithEmails} conversas ainda contêm emails.\n`);
    }

    // 4. Resumo
    console.log('📊 RESUMO DA MIGRAÇÃO:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total de conversas afetadas: ${conversationsWithEmails.length}`);
    console.log(`Emails removidos de client: ${results.client}`);
    console.log(`Emails removidos de booster: ${results.booster}`);
    console.log(`Emails removidos de marketplace.buyer: ${results.buyerMarketplace}`);
    console.log(`Emails removidos de marketplace.seller: ${results.sellerMarketplace}`);
    console.log(`Total de updates: ${results.client + results.booster + results.buyerMarketplace + results.sellerMarketplace}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('✅ Migração finalizada!');
    await mongoose.disconnect();
    console.log('🔌 Desconectado do MongoDB');

  } catch (error) {
    console.error('❌ Erro durante migração:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Executar migração
if (require.main === module) {
  migrateConversations();
}

module.exports = migrateConversations;

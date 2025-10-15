const mongoose = require('mongoose');
require('dotenv').config();

const Agreement = require('./src/models/Agreement');
const AcceptedProposal = require('./src/models/AcceptedProposal');
const Conversation = require('./src/models/Conversation');
const User = require('./src/models/User');

// Conversa específica com problema
const CONVERSATION_ID = process.argv[2] || '68eede1f766cc53fdff40749';

async function createAgreementForConversation() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Conectado ao MongoDB');
    console.log(`🔍 Criando Agreement para conversa: ${CONVERSATION_ID}\n`);
    
    // Buscar conversa
    const conv = await Conversation.findById(CONVERSATION_ID);
    
    if (!conv) {
      console.error(`❌ Conversa não encontrada: ${CONVERSATION_ID}`);
      process.exit(1);
    }
    
    console.log('✅ Conversa encontrada:');
    console.log(`   _id: ${conv._id}`);
    console.log(`   type: ${conv.type}`);
    console.log(`   isTemporary: ${conv.isTemporary}`);
    console.log(`   status: ${conv.status}`);
    console.log(`   boostingStatus: ${conv.boostingStatus}`);
    console.log(`   participants: ${conv.participants?.join(', ')}`);
    
    const metadata = conv.metadata instanceof Map 
      ? Object.fromEntries(conv.metadata) 
      : (conv.metadata || {});
    
    console.log(`   metadata:`, JSON.stringify(metadata, null, 2));
    console.log('');
    
    // Verificar se já existe Agreement
    const existingAgreement = await Agreement.findOne({ conversationId: CONVERSATION_ID });
    
    if (existingAgreement) {
      console.log(`✅ Agreement JÁ EXISTE: ${existingAgreement.agreementId}`);
      console.log(`   Status: ${existingAgreement.status}`);
      console.log(`   Price: R$ ${existingAgreement.proposalSnapshot?.price}`);
      console.log('\n💡 Não é necessário criar novo Agreement.');
      process.exit(0);
    }
    
    console.log('📝 Agreement NÃO existe, criando...\n');
    
    // Buscar AcceptedProposal se existir
    const acceptedProposal = await AcceptedProposal.findOne({ conversationId: CONVERSATION_ID });
    
    if (acceptedProposal) {
      console.log('✅ AcceptedProposal encontrado:');
      console.log(`   client.userid: ${acceptedProposal.client?.userid}`);
      console.log(`   booster.userid: ${acceptedProposal.booster?.userid}`);
      console.log(`   price: ${acceptedProposal.price}`);
      console.log('');
    }
    
    // Identificar participantes
    const participants = conv.participants || [];
    
    let clientId = metadata.clientId || acceptedProposal?.client?.userid || participants[0];
    let boosterId = metadata.boosterId || acceptedProposal?.booster?.userid || participants[1];
    
    console.log('🔍 IDs identificados:');
    console.log(`   clientId: ${clientId}`);
    console.log(`   boosterId: ${boosterId}`);
    console.log('');
    
    // Buscar usuários
    const clientUser = await User.findById(clientId);
    const boosterUser = await User.findById(boosterId);
    
    if (!clientUser) {
      console.error(`❌ Cliente não encontrado: ${clientId}`);
      console.log('\n💡 Tente fornecer o clientId correto manualmente.');
      process.exit(1);
    }
    
    if (!boosterUser) {
      console.error(`❌ Booster não encontrado: ${boosterId}`);
      console.log('\n💡 Tente fornecer o boosterId correto manualmente.');
      process.exit(1);
    }
    
    console.log('✅ Usuários encontrados:');
    console.log(`   Client: ${clientUser.name} (${clientUser.email})`);
    console.log(`   Booster: ${boosterUser.name} (${boosterUser.email})`);
    console.log('');
    
    // Extrair dados da proposta (pode estar em metadata.proposalData)
    const proposalData = metadata.proposalData || {};
    const proposalId = metadata.proposalId || metadata.actualProposalId || conv.proposal || conv._id;
    const proposalPrice = proposalData.price || acceptedProposal?.price || metadata.price || metadata.proposedPrice || 300;
    
    console.log('📋 Dados da proposta:');
    console.log(`   proposalId: ${proposalId}`);
    console.log(`   price: R$ ${proposalPrice}`);
    console.log(`   game: ${proposalData.game || metadata.game || 'N/A'}`);
    console.log(`   category: ${proposalData.category || metadata.category || 'Boosting'}`);
    console.log(`   description: ${proposalData.description || metadata.description || 'N/A'}`);
    console.log('');
    
    if (!proposalPrice || proposalPrice <= 0) {
      console.error(`❌ Preço inválido: ${proposalPrice}`);
      console.log('\n💡 Forneça um preço válido manualmente.');
      process.exit(1);
    }
    
    // Criar Agreement
    console.log('🚀 Criando Agreement...\n');
    
    const agreement = new Agreement({
      conversationId: conv._id,
      proposalId: mongoose.Types.ObjectId.isValid(proposalId) ? proposalId : conv._id,
      proposalSnapshot: {
        game: proposalData.game || metadata.game || 'N/A',
        category: proposalData.category || metadata.category || metadata.boostingCategory || 'Boosting',
        currentRank: proposalData.currentRank || metadata.currentRank || 'N/A',
        desiredRank: proposalData.desiredRank || metadata.desiredRank || 'N/A',
        description: proposalData.description || metadata.description || proposalData.message || metadata.message || 'Serviço de boosting',
        price: proposalPrice,
        originalPrice: proposalPrice,
        estimatedTime: proposalData.estimatedTime || metadata.estimatedTime || '1 hora'
      },
      parties: {
        client: {
          userid: clientId,
          name: clientUser.name || clientUser.username,
          email: clientUser.email,
          avatar: clientUser.avatar,
          metadata: new Map([
            ['isVerified', clientUser.isVerified || false],
            ['totalOrders', clientUser.totalOrders || 0],
            ['rating', clientUser.rating || 0]
          ])
        },
        booster: {
          userid: boosterId,
          name: boosterUser.name || boosterUser.username,
          email: boosterUser.email,
          avatar: boosterUser.avatar,
          rating: boosterUser.rating || 0,
          metadata: new Map([
            ['isVerified', boosterUser.isVerified || false],
            ['totalBoosts', boosterUser.totalBoosts || 0],
            ['completedBoosts', boosterUser.completedBoosts || 0]
          ])
        }
      },
      financial: {
        totalAmount: proposalPrice,
        currency: 'BRL',
        paymentStatus: 'pending'
      },
      status: conv.boostingStatus === 'completed' ? 'completed' : 'active'
    });
    
    agreement.addAction('created', clientId, { 
      proposalId: proposalId,
      manuallyCreated: true,
      createdAt: new Date()
    });
    
    // Se já foi completado, adicionar action
    if (conv.boostingStatus === 'completed') {
      agreement.addAction('completed', clientId, {
        completedAt: conv.deliveryConfirmedAt || new Date(),
        manualCompletion: true
      });
    }
    
    await agreement.save();
    
    // Atualizar conversa com agreementId
    conv.metadata = conv.metadata || new Map();
    if (conv.metadata instanceof Map) {
      conv.metadata.set('latestAgreementId', agreement.agreementId);
    } else {
      conv.metadata.latestAgreementId = agreement.agreementId;
    }
    await conv.save();
    
    console.log('=' .repeat(80));
    console.log('✅ AGREEMENT CRIADO COM SUCESSO!');
    console.log('='.repeat(80));
    console.log(`   agreementId: ${agreement.agreementId}`);
    console.log(`   conversationId: ${agreement.conversationId}`);
    console.log(`   proposalId: ${agreement.proposalId}`);
    console.log(`   status: ${agreement.status}`);
    console.log(`   price: R$ ${agreement.proposalSnapshot.price}`);
    console.log(`   client: ${agreement.parties.client.name}`);
    console.log(`   booster: ${agreement.parties.booster.name}`);
    console.log('='.repeat(80));
    console.log('\n💡 Agora você pode confirmar a entrega normalmente!');
    console.log('\nTestar com:');
    console.log(`curl -X POST https://zenith.enrelyugi.com.br/api/boosting-chat/conversation/${CONVERSATION_ID}/confirm-delivery -H "Authorization: Bearer TOKEN"`);
    
  } catch (error) {
    console.error('❌ Erro fatal:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Desconectado do MongoDB');
  }
}

createAgreementForConversation();

const mongoose = require('mongoose');
require('dotenv').config();

const Agreement = require('./src/models/Agreement');
const AcceptedProposal = require('./src/models/AcceptedProposal');
const Conversation = require('./src/models/Conversation');
const User = require('./src/models/User');

async function createMissingAgreements() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Conectado ao MongoDB');
    console.log('🔍 Buscando conversas de boosting sem Agreement...\n');
    
    // Primeiro, vamos ver TODAS as conversas para entender a estrutura
    const allConversations = await Conversation.find({}).limit(10);
    console.log('📋 Primeiras 10 conversas no banco:');
    allConversations.forEach((conv, idx) => {
      console.log(`   ${idx + 1}. _id: ${conv._id}`);
      console.log(`      type: ${conv.type}`);
      console.log(`      isTemporary: ${conv.isTemporary}`);
      console.log(`      status: ${conv.status}`);
      console.log(`      boostingStatus: ${conv.boostingStatus}`);
      console.log(`      participants: ${conv.participants?.length || 0}`);
    });
    console.log('');
    
    // Buscar conversas de boosting com critérios mais flexíveis
    const conversations = await Conversation.find({
      $or: [
        { type: 'boosting' },
        { boostingStatus: { $exists: true } },
        { 'metadata.boostingId': { $exists: true } }
      ],
      isTemporary: false
    });
    
    console.log(`📊 Total de conversas de boosting encontradas: ${conversations.length}\n`);
    
    let created = 0;
    let alreadyExists = 0;
    let errors = 0;
    
    for (const conv of conversations) {
      try {
        console.log('='.repeat(80));
        console.log(`🔍 Processando conversa: ${conv._id}`);
        console.log(`   Status: ${conv.status}, BoostingStatus: ${conv.boostingStatus}`);
        
        // Verifica se já existe Agreement
        const existingAgreement = await Agreement.findOne({ conversationId: conv._id });
        
        if (existingAgreement) {
          console.log(`✅ Agreement já existe: ${existingAgreement.agreementId}`);
          alreadyExists++;
          continue;
        }
        
        console.log('📝 Agreement não existe, criando...');
        
        // Extrair dados da conversa
        const metadata = conv.metadata instanceof Map 
          ? Object.fromEntries(conv.metadata) 
          : (conv.metadata || {});
        
        const proposalData = metadata.proposalData || {};
        
        console.log('   Metadata:', JSON.stringify(metadata, null, 2));
        
        // Identificar participantes (cliente e booster)
        const participants = conv.participants || [];
        if (participants.length < 2) {
          console.error(`❌ Conversa sem participantes suficientes: ${participants.length}`);
          errors++;
          continue;
        }
        
        // Tentar identificar cliente e booster
        let clientId, boosterId;
        
        // Opção 1: Metadata tem client e booster
        if (metadata.clientId) {
          clientId = metadata.clientId;
        }
        if (metadata.boosterId) {
          boosterId = metadata.boosterId;
        }
        
        // Opção 2: AcceptedProposal
        if (!clientId || !boosterId) {
          const acceptedProposal = await AcceptedProposal.findOne({ conversationId: conv._id });
          if (acceptedProposal) {
            clientId = acceptedProposal.client?.userid || clientId;
            boosterId = acceptedProposal.booster?.userid || boosterId;
            console.log('   Found AcceptedProposal:', {
              clientId,
              boosterId,
              price: acceptedProposal.price
            });
          }
        }
        
        // Opção 3: Assumir primeiro participante é cliente, segundo é booster
        if (!clientId) {
          clientId = participants[0];
          console.log(`   Assuming participant[0] is client: ${clientId}`);
        }
        if (!boosterId) {
          boosterId = participants[1];
          console.log(`   Assuming participant[1] is booster: ${boosterId}`);
        }
        
        // Buscar dados dos usuários
        const clientUser = await User.findById(clientId);
        const boosterUser = await User.findById(boosterId);
        
        if (!clientUser) {
          console.error(`❌ Cliente não encontrado: ${clientId}`);
          errors++;
          continue;
        }
        
        if (!boosterUser) {
          console.error(`❌ Booster não encontrado: ${boosterId}`);
          errors++;
          continue;
        }
        
        console.log('   ✅ Users found:', {
          client: clientUser.name,
          booster: boosterUser.name
        });
        
        // Extrair dados da proposta
        const proposalId = metadata.proposalId || metadata.actualProposalId || conv.proposal;
        const proposalPrice = proposalData.price || acceptedProposal?.price || metadata.price || metadata.proposedPrice || 0;
        
        console.log('   Proposal data:', {
          proposalId,
          proposalPrice,
          game: proposalData.game || metadata.game,
          category: proposalData.category || metadata.category,
          description: proposalData.description || metadata.description
        });
        
        if (!proposalPrice || proposalPrice <= 0) {
          console.error(`❌ Preço inválido: ${proposalPrice}`);
          errors++;
          continue;
        }
        
        // Validar proposalId é ObjectId válido
        if (!mongoose.Types.ObjectId.isValid(proposalId)) {
          console.warn(`⚠️ ProposalId não é ObjectId válido: ${proposalId}, usando conversationId`);
        }
        
        // Criar Agreement
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
          migratedFrom: 'conversation',
          migrationDate: new Date()
        });
        
        // Se já foi completado, adicionar action
        if (conv.boostingStatus === 'completed') {
          agreement.addAction('completed', clientId, {
            completedAt: conv.deliveryConfirmedAt || new Date(),
            migratedCompletion: true
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
        
        console.log(`✅ Agreement criado com sucesso: ${agreement.agreementId}`);
        console.log(`   ConversationId: ${agreement.conversationId}`);
        console.log(`   ProposalId: ${agreement.proposalId}`);
        console.log(`   Price: R$ ${agreement.proposalSnapshot.price}`);
        console.log(`   Status: ${agreement.status}`);
        
        created++;
        
      } catch (error) {
        console.error(`❌ Erro ao processar conversa ${conv._id}:`, error.message);
        console.error('   Stack:', error.stack);
        errors++;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMO DA MIGRAÇÃO');
    console.log('='.repeat(80));
    console.log(`Total de conversas processadas: ${conversations.length}`);
    console.log(`✅ Agreements criados: ${created}`);
    console.log(`ℹ️  Agreements já existiam: ${alreadyExists}`);
    console.log(`❌ Erros: ${errors}`);
    console.log('='.repeat(80));
    
    if (created > 0) {
      console.log('\n✅ Migração concluída com sucesso!');
      console.log('💡 Agora você pode confirmar entregas normalmente.');
    } else if (alreadyExists > 0) {
      console.log('\n✅ Todos os Agreements já existiam.');
    } else {
      console.log('\n⚠️ Nenhum Agreement foi criado. Verifique os erros acima.');
    }
    
  } catch (error) {
    console.error('❌ Erro fatal:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Desconectado do MongoDB');
  }
}

createMissingAgreements();

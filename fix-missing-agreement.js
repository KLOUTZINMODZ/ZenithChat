/**
 * Script de Diagnóstico e Correção: Agreement Faltante
 * 
 * Objetivo: Verificar e criar Agreement para conversas que foram aceitas
 * mas não têm Agreement criado.
 * 
 * Uso: node fix-missing-agreement.js <conversationId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Conversation = require('./src/models/Conversation');
const Agreement = require('./src/models/Agreement');
const AcceptedProposal = require('./src/models/AcceptedProposal');
const User = require('./src/models/User');

const conversationId = process.argv[2] || '68ee956fd6d556c36cd373bb';

async function diagnoseAndFix() {
  try {
    console.log('🔍 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hacklote_chat');
    console.log('✅ Conectado ao MongoDB\n');

    console.log(`📋 Analisando conversa: ${conversationId}\n`);

    // 1. Buscar conversa
    console.log('1️⃣ Buscando conversa...');
    const conversation = await Conversation.findById(conversationId);
    
    if (!conversation) {
      console.error('❌ Conversa não encontrada!');
      process.exit(1);
    }
    
    console.log('✅ Conversa encontrada:');
    console.log(`   - Status: ${conversation.status}`);
    console.log(`   - isTemporary: ${conversation.isTemporary}`);
    console.log(`   - boostingStatus: ${conversation.boostingStatus}`);
    console.log(`   - Participantes: ${conversation.participants.length}`);
    console.log(`   - Metadata:`, conversation.metadata ? Object.fromEntries(conversation.metadata) : {});
    console.log('');

    // 2. Buscar Agreement
    console.log('2️⃣ Buscando Agreement...');
    let agreement = await Agreement.findOne({ conversationId });
    
    if (agreement) {
      console.log('✅ Agreement encontrado:');
      console.log(`   - agreementId: ${agreement.agreementId}`);
      console.log(`   - status: ${agreement.status}`);
      console.log(`   - totalAmount: R$ ${agreement.financial?.totalAmount}`);
      console.log(`   - Client: ${agreement.parties?.client?.name} (${agreement.parties?.client?.userid})`);
      console.log(`   - Booster: ${agreement.parties?.booster?.name} (${agreement.parties?.booster?.userid})`);
      console.log('\n✅ DIAGNÓSTICO: Agreement existe, não há problema!');
      console.log('   Se o erro persiste, verifique se o ID da conversa está correto.');
      process.exit(0);
    }
    
    console.log('⚠️  Agreement NÃO encontrado! Verificando AcceptedProposal...\n');

    // 3. Buscar AcceptedProposal
    console.log('3️⃣ Buscando AcceptedProposal...');
    const acceptedProposal = await AcceptedProposal.findOne({ conversationId });
    
    if (acceptedProposal) {
      console.log('✅ AcceptedProposal encontrado:');
      console.log(`   - _id: ${acceptedProposal._id}`);
      console.log(`   - price: R$ ${acceptedProposal.price}`);
      console.log(`   - Client: ${acceptedProposal.client?.name}`);
      console.log(`   - Booster: ${acceptedProposal.booster?.name}`);
      console.log('\n📝 Tentando migração automática...\n');
      
      try {
        const AgreementMigration = require('./src/middleware/agreementMigrationMiddleware');
        agreement = await AgreementMigration.migrateProposalToAgreement(acceptedProposal);
        
        console.log('✅ Agreement criado via migração:');
        console.log(`   - agreementId: ${agreement.agreementId}`);
        console.log(`   - status: ${agreement.status}`);
        console.log('\n✅ CORREÇÃO APLICADA! Teste novamente a confirmação de entrega.');
        process.exit(0);
      } catch (migrationError) {
        console.error('❌ Erro na migração:', migrationError.message);
        console.log('\n⚠️  Tentando criar Agreement manualmente...\n');
      }
    } else {
      console.log('⚠️  AcceptedProposal NÃO encontrado!\n');
    }

    // 4. Criar Agreement manualmente
    console.log('4️⃣ Criando Agreement manualmente...');
    
    // Extrair dados da conversa
    const participants = conversation.participants;
    if (participants.length < 2) {
      console.error('❌ Conversa precisa ter pelo menos 2 participantes!');
      process.exit(1);
    }

    // Identificar cliente e booster
    const metadata = conversation.metadata ? Object.fromEntries(conversation.metadata) : {};
    
    let clientId, boosterId;
    
    // Tentar identificar pelos participantes (assumir primeiro = cliente, segundo = booster)
    if (participants.length >= 2) {
      clientId = participants[0];
      boosterId = participants[1];
    }

    console.log(`   - ClientId: ${clientId}`);
    console.log(`   - BoosterId: ${boosterId}`);

    // Buscar dados dos usuários
    const clientUser = await User.findById(clientId);
    const boosterUser = await User.findById(boosterId);

    if (!clientUser || !boosterUser) {
      console.error('❌ Não foi possível encontrar dados dos usuários!');
      console.log(`   - Cliente encontrado: ${!!clientUser}`);
      console.log(`   - Booster encontrado: ${!!boosterUser}`);
      process.exit(1);
    }

    console.log(`   - Cliente: ${clientUser.name || clientUser.username}`);
    console.log(`   - Booster: ${boosterUser.name || boosterUser.username}`);

    // Extrair preço do metadata (verificar múltiplos caminhos possíveis)
    const proposalPrice = metadata.proposalData?.price || metadata.price || metadata.proposedPrice || 0;
    let proposalId = metadata.proposalId || metadata.boostingId || 'unknown';
    
    // Se proposalId está no formato composto (boostingId_boosterId_timestamp), extrair apenas boostingId
    if (proposalId.includes('_')) {
      const parts = proposalId.split('_');
      proposalId = parts[0]; // Usa apenas o boostingId (primeira parte)
      console.log(`   - ProposalId composto detectado, usando boostingId: ${proposalId}`);
    }

    console.log(`   - Preço: R$ ${proposalPrice}`);
    console.log(`   - ProposalId: ${proposalId}`);

    if (proposalPrice <= 0) {
      console.error('\n⚠️  AVISO: Preço não encontrado no metadata!');
      console.log('   Você pode fornecer manualmente:');
      console.log('   Edite o script e defina: const manualPrice = 100; // seu valor');
      
      // Opção: definir preço manual aqui
      const manualPrice = null; // Defina o preço aqui se necessário
      
      if (!manualPrice) {
        console.error('❌ Preço é obrigatório para criar Agreement');
        process.exit(1);
      }
    }

    // Criar Agreement
    const proposalData = metadata.proposalData || {};
    const newAgreement = new Agreement({
      conversationId,
      proposalId,
      proposalSnapshot: {
        game: proposalData.game || metadata.game || 'N/A',
        category: proposalData.category || metadata.category || metadata.boostingCategory || 'Boosting',
        currentRank: proposalData.currentRank || metadata.currentRank || 'N/A',
        desiredRank: proposalData.desiredRank || metadata.desiredRank || 'N/A',
        description: proposalData.description || metadata.description || '',
        price: proposalPrice,
        originalPrice: proposalPrice,
        estimatedTime: proposalData.estimatedTime || metadata.estimatedTime || ''
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
      status: 'active'
    });

    newAgreement.addAction('created', clientId, { 
      proposalId,
      createdBy: 'fix-script',
      reason: 'Missing agreement detected and auto-created'
    });

    await newAgreement.save();

    console.log('\n✅ Agreement criado com sucesso!');
    console.log(`   - agreementId: ${newAgreement.agreementId}`);
    console.log(`   - _id: ${newAgreement._id}`);
    console.log(`   - status: ${newAgreement.status}`);
    console.log(`   - totalAmount: R$ ${newAgreement.financial.totalAmount}`);

    // Atualizar metadata da conversa
    if (!conversation.metadata) {
      conversation.metadata = new Map();
    }
    conversation.metadata.set('latestAgreementId', newAgreement.agreementId);
    await conversation.save();

    console.log('\n✅ Conversa atualizada com agreementId');
    console.log('\n🎉 CORREÇÃO COMPLETA!');
    console.log('\n📝 Próximos passos:');
    console.log('   1. Tente confirmar a entrega novamente');
    console.log('   2. Deve funcionar sem o erro 404');
    console.log('   3. Monitore os logs para verificar');

  } catch (error) {
    console.error('\n❌ Erro durante execução:', error);
    console.error('Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado do MongoDB');
  }
}

// Executar
diagnoseAndFix();

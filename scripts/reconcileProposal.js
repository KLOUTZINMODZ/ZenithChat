/**
 * Script para reconciliar uma proposta específica
 * 
 * Uso: node reconcileProposal.js 16.01
 */
require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../src/utils/logger');

// Modelos
const AcceptedProposal = require('../src/models/AcceptedProposal');
const Agreement = require('../src/models/Agreement');
const BoostingOrder = require('../src/models/BoostingOrder');
const Conversation = require('../src/models/Conversation');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hacklote';

/**
 * Encontrar e corrigir proposta por preço específico
 */
async function reconcileProposalByPrice(price) {
  try {
    // Conectar ao MongoDB
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('📦 Conectado ao MongoDB');

    // Converter preço para número
    const targetPrice = Number(price);
    if (isNaN(targetPrice)) {
      throw new Error('Preço inválido');
    }

    console.log(`🔍 Buscando proposta com preço R$ ${targetPrice.toFixed(2)}...`);
    
    // Buscar todas as propostas aceitas
    const proposals = await AcceptedProposal.find().lean();
    console.log(`📊 Total de propostas encontradas: ${proposals.length}`);
    
    // Filtrar propostas pelo preço
    const matchingProposals = proposals.filter(p => {
      // Extrair preço da proposta
      let propPrice;
      if (typeof p.proposalData?.price === 'string') {
        propPrice = parseFloat(p.proposalData.price.replace(/\./g, '').replace(',', '.'));
      } else {
        propPrice = Number(p.proposalData?.price || 0);
      }
      
      // Comparar com margem de erro de 0.01
      return Math.abs(propPrice - targetPrice) < 0.01;
    });

    if (matchingProposals.length === 0) {
      // Se não encontrou proposta, procurar em conversas temporárias
      console.log('⚠️ Nenhuma proposta aceita encontrada com esse preço. Buscando em conversas...');
      
      const conversations = await Conversation.find({
        'metadata.proposalData.price': { $exists: true }
      }).lean();
      
      const matchingConvs = conversations.filter(c => {
        let convPrice;
        const price = c.metadata?.get?.('proposalData')?.price || 
                     c.metadata?.proposalData?.price;
                     
        if (typeof price === 'string') {
          convPrice = parseFloat(price.replace(/\./g, '').replace(',', '.'));
        } else {
          convPrice = Number(price || 0);
        }
        
        return Math.abs(convPrice - targetPrice) < 0.01;
      });
      
      if (matchingConvs.length === 0) {
        console.log('❌ Nenhuma conversa encontrada com esse preço.');
        return { found: false };
      }
      
      console.log(`🎯 Encontradas ${matchingConvs.length} conversas com preço R$ ${targetPrice.toFixed(2)}`);
      
      // Para cada conversa, verificar se já tem proposta aceita
      for (const conv of matchingConvs) {
        console.log(`📝 Conversação: ${conv._id}, Status: ${conv.status}, Temporary: ${conv.isTemporary}`);
        
        if (conv.status === 'accepted' && !conv.isTemporary) {
          console.log('✅ Conversa já aceita. Verificando se tem proposta aceita...');
          
          // Verificar se existe proposta aceita
          let acceptedProposal;
          if (conv.acceptedProposal) {
            acceptedProposal = await AcceptedProposal.findById(conv.acceptedProposal);
          }
          
          if (!acceptedProposal) {
            console.log('⚠️ Conversa aceita mas sem proposta aceita registrada. Criando proposta...');
            
            // Criar proposta aceita
            const proposalData = conv.metadata?.get?.('proposalData') || 
                                conv.metadata?.proposalData || {};
            const clientData = conv.metadata?.get?.('clientData') || 
                              conv.metadata?.clientData || {};
            const boosterData = conv.metadata?.get?.('boosterData') || 
                               conv.metadata?.boosterData || {};
            
            acceptedProposal = new AcceptedProposal({
              conversationId: conv._id,
              proposalId: conv.proposal,
              proposalData,
              clientData,
              boosterData,
              status: 'active',
              acceptedAt: conv.updatedAt || new Date()
            });
            
            await acceptedProposal.save();
            console.log(`✅ Proposta aceita criada: ${acceptedProposal._id}`);
            
            // Atualizar conversa
            conv.acceptedProposal = acceptedProposal._id;
            await Conversation.updateOne(
              { _id: conv._id },
              { $set: { acceptedProposal: acceptedProposal._id } }
            );
            
            matchingProposals.push(acceptedProposal);
          }
        } else if (conv.status === 'pending' && conv.isTemporary) {
          console.log('⚠️ Conversa temporária pendente. Aceitando proposta...');
          
          // Aceitar proposta
          conv.isTemporary = false;
          conv.status = 'accepted';
          conv.boostingStatus = 'active';
          
          // Obter dados
          const proposalData = conv.metadata?.get?.('proposalData') || 
                              conv.metadata?.proposalData || {};
          const clientData = conv.metadata?.get?.('clientData') || 
                            conv.metadata?.clientData || {};
          const boosterData = conv.metadata?.get?.('boosterData') || 
                             conv.metadata?.boosterData || {};
          
          // Criar proposta aceita
          const acceptedProposal = new AcceptedProposal({
            conversationId: conv._id,
            proposalId: conv.proposal,
            proposalData,
            clientData,
            boosterData,
            status: 'active',
            acceptedAt: new Date()
          });
          
          await acceptedProposal.save();
          console.log(`✅ Proposta aceita criada: ${acceptedProposal._id}`);
          
          // Atualizar conversa
          conv.acceptedProposal = acceptedProposal._id;
          await Conversation.updateOne(
            { _id: conv._id },
            { 
              $set: { 
                acceptedProposal: acceptedProposal._id,
                isTemporary: false,
                status: 'accepted',
                boostingStatus: 'active',
              }
            }
          );
          
          matchingProposals.push(acceptedProposal);
        }
      }
      
      if (matchingProposals.length === 0) {
        console.log('❌ Não foi possível criar propostas aceitas a partir das conversas.');
        return { found: false };
      }
    }

    console.log(`🎯 Encontradas ${matchingProposals.length} propostas com preço R$ ${targetPrice.toFixed(2)}`);
    
    // Para cada proposta, verificar agreement e criar se necessário
    for (const proposal of matchingProposals) {
      console.log(`\n📝 Processando proposta: ${proposal._id}, Preço: ${proposal.proposalData?.price}`);
      
      // Verificar se já existe um Agreement
      const existingAgreement = await Agreement.findOne({
        $or: [
          { proposalId: proposal.proposalId },
          { acceptedProposalId: proposal._id },
          { conversationId: proposal.conversationId }
        ]
      });
      
      let agreement = existingAgreement;
      
      if (!existingAgreement) {
        console.log('⚠️ Nenhum Agreement encontrado. Criando novo Agreement...');
        
        // Converter preço
        let _priceValue;
        if (typeof proposal.proposalData?.price === 'string') {
          _priceValue = parseFloat(proposal.proposalData.price.replace(/\./g, '').replace(',', '.'));
        } else {
          _priceValue = Number(proposal.proposalData?.price || 0);
        }
        
        // Criar Agreement
        agreement = new Agreement({
          conversationId: proposal.conversationId,
          proposalId: proposal.proposalId,
          acceptedProposalId: proposal._id,
          proposalSnapshot: {
            game: proposal.proposalData?.game || 'N/A',
            category: proposal.proposalData?.category || 'Boosting',
            currentRank: proposal.proposalData?.currentRank || 'N/A',
            desiredRank: proposal.proposalData?.desiredRank || 'N/A',
            description: proposal.proposalData?.description || '',
            price: _priceValue,
            originalPrice: _priceValue,
            estimatedTime: proposal.proposalData?.estimatedTime || ''
          },
          parties: {
            client: {
              userid: proposal.clientData?.userid,
              name: proposal.clientData?.name,
              email: proposal.clientData?.email || '',
              avatar: proposal.clientData?.avatar || '',
              metadata: new Map([
                ['isVerified', proposal.clientData?.isVerified || false]
              ])
            },
            booster: {
              userid: proposal.boosterData?.userid,
              name: proposal.boosterData?.name,
              email: proposal.boosterData?.email || '',
              avatar: proposal.boosterData?.avatar || '',
              metadata: new Map([
                ['rating', proposal.boosterData?.rating || 0]
              ])
            }
          },
          financial: {
            totalAmount: _priceValue,
            currency: 'BRL',
            paymentStatus: 'pending'
          },
          status: 'active'
        });
        
        agreement.addAction('created', proposal.clientData?.userid, { proposalId: proposal.proposalId });
        await agreement.save();
        console.log(`✅ Agreement criado com sucesso: ${agreement.agreementId}`);
        
        // Atualizar conversa com agreementId
        await Conversation.updateOne(
          { _id: proposal.conversationId },
          { 
            $set: {
              agreementId: agreement.agreementId,
              'metadata.latestAgreementId': agreement.agreementId
            }
          }
        );
      } else {
        console.log(`✅ Agreement já existe: ${existingAgreement.agreementId}, Status: ${existingAgreement.status}`);
      }
      
      // Verificar se já existe um BoostingOrder
      const existingBoostingOrder = await BoostingOrder.findOne({ agreementId: agreement._id });
      
      if (!existingBoostingOrder) {
        console.log('⚠️ Nenhum BoostingOrder encontrado. Criando novo BoostingOrder...');
        
        // Criar BoostingOrder
        try {
          const boostingOrder = await BoostingOrder.createFromAgreement(agreement);
          console.log(`✅ BoostingOrder criado com sucesso: ${boostingOrder._id}`);
        } catch (error) {
          console.error(`❌ Erro ao criar BoostingOrder:`, error);
        }
      } else {
        console.log(`✅ BoostingOrder já existe: ${existingBoostingOrder._id}, Status: ${existingBoostingOrder.status}`);
      }
    }
    
    // Resultado final
    const result = {
      found: true,
      proposals: matchingProposals.length,
      fixed: true,
      message: `Reconciliação concluída para proposta de R$ ${targetPrice.toFixed(2)}`
    };
    
    console.log(`\n🎉 RECONCILIAÇÃO CONCLUÍDA COM SUCESSO!`);
    console.log(`Propostas processadas: ${matchingProposals.length}`);
    console.log(`A proposta de R$ ${targetPrice.toFixed(2)} agora deve aparecer em todas as listagens.`);
    
    return result;
  } catch (error) {
    console.error('❌ ERRO:', error);
    return { found: false, error: error.message };
  } finally {
    // Fechar conexão
    await mongoose.disconnect();
    console.log('📦 Desconectado do MongoDB');
  }
}

// Executar script se chamado diretamente
if (require.main === module) {
  // Obter preço da linha de comando
  const priceArg = process.argv[2];
  
  if (!priceArg) {
    console.error('❌ Por favor, informe o preço da proposta: node reconcileProposal.js 16.01');
    process.exit(1);
  }
  
  reconcileProposalByPrice(priceArg)
    .then(() => {
      console.log('✅ Script concluído');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Erro ao executar script:', err);
      process.exit(1);
    });
}

module.exports = { reconcileProposalByPrice };

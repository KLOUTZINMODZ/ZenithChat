const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');


const axios = require('axios');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Agreement = require('../models/Agreement');
const AcceptedProposal = require('../models/AcceptedProposal');


router.get('/', (req, res) => {
  res.json({
    message: 'Proposals API',
    endpoints: {
      accept: 'POST /:proposalId/accept'
    },
    timestamp: new Date().toISOString()
  });
});


router.get('/:proposalId/accept', auth, async (req, res) => {
  try {
    const { proposalId } = req.params;
    
    console.log(`🔍 [Proposal Accept GET] Received request for proposal: ${proposalId}`);
    

    res.status(405).json({
      success: false,
      message: 'Method Not Allowed. Use POST method to accept proposals.',
      allowedMethods: ['POST'],
      endpoint: `POST /api/proposals/${proposalId}/accept`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [Proposal Accept GET] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

router.post('/:proposalId/accept', auth, async (req, res) => {
  try {
    const { proposalId } = req.params;
    let { conversationId, boosterId, clientId, metadata = {} } = req.body;
    let actualProposalId = proposalId;
    let boostingId = metadata?.boostingId;
    let lookupData = null;
    
    // Normaliza IDs que podem vir como objetos
    if (typeof boosterId === 'object' && boosterId) {
      boosterId = boosterId._id || boosterId.id;
    }
    if (typeof clientId === 'object' && clientId) {
      clientId = clientId._id || clientId.id;
    }

    console.log(`🔍 [Proposal Accept] Received request for proposal: ${proposalId}`);
    console.log(`🔍 [Proposal Accept] ConversationId: ${conversationId}`);
    console.log(`🔍 [Proposal Accept] BoosterId (normalized): ${boosterId}`);
    console.log(`🔍 [Proposal Accept] ClientId (normalized): ${clientId}`);
    console.log(`🔍 [Proposal Accept] Metadata:`, metadata);
    console.log(`🔍 [Proposal Accept] Checking boostingId: ${boostingId} (type: ${typeof boostingId})`);
    console.log(`🔍 [Proposal Accept] Metadata boostingId exists: ${!!metadata?.boostingId}`);
    console.log(`🔍 [Proposal Accept] Metadata proposalId: ${metadata?.proposalId}`);
    

    if (metadata?.proposalId) {
      actualProposalId = metadata.proposalId;
      console.log(`✅ [Proposal Accept] Using proposalId from metadata: ${actualProposalId}`);
    }
    
    if (!boostingId) {
      console.log(`⚠️ [Proposal Accept] No boostingId in metadata, attempting database lookup for proposalId: ${proposalId}`);
      
      try {

        const proposalLookupUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api'}/proposals/${proposalId}/boosting-id`;
        console.log(`🔍 [Proposal Accept] Looking up boostingId at: ${proposalLookupUrl}`);
        
        const lookupResponse = await axios.get(proposalLookupUrl, {
          headers: { Authorization: req.headers.authorization }
        });
        
        console.log('✅ [Proposal Accept] Lookup successful:', lookupResponse.data);
        lookupData = lookupResponse.data;
        boostingId = lookupResponse.data.boostingId;
        

        if (lookupResponse.data.actualProposalId) {
          actualProposalId = lookupResponse.data.actualProposalId;
          console.log('✅ [Proposal Accept] Using actualProposalId from lookup:', actualProposalId);
        }
      } catch (lookupError) {
        console.log('❌ [Proposal Accept] Lookup failed:', lookupError.message);
        console.log('❌ [Proposal Accept] Lookup error details:', lookupError.response?.data);
        
        const mongoose = require('mongoose');
        if (mongoose.Types.ObjectId.isValid(proposalId)) {
          console.log('🔍 [Proposal Accept] Checking if proposalId', proposalId, 'is actually a boostingId...');
          console.log('✅ [Proposal Accept] ProposalId', proposalId, 'is a valid ObjectId, using as boostingId');
          boostingId = proposalId;
        } else {
          console.log('❌ [Proposal Accept] ProposalId is not a valid ObjectId, cannot proceed');
          return res.status(400).json({
            success: false,
            message: 'Não foi possível encontrar o boostingId para esta proposta',
            details: {
              proposalId: proposalId,
              lookupUrl: `${process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api'}/proposals/${proposalId}/boosting-id`,
              originalError: lookupError.response?.data || lookupError.message
            }
          });
        }
      }
    }
    
    console.log(`🔍 [Proposal Accept] Final BoostingId: ${boostingId}`);
    
    if (!boostingId || boostingId === 'undefined') {
      console.error(`❌ [Proposal Accept] Invalid boostingId: ${boostingId}`);
      return res.status(500).json({
        success: false,
        message: 'BoostingId inválido ou não encontrado',
        error: 'Invalid boostingId',
        details: {
          proposalId: proposalId,
          boostingId: boostingId,
          metadata: metadata
        }
      });
    }


    // Se proposalId contém underscore, é o formato composto (boostingId_boosterId_timestamp)
    // Precisamos buscar o ID real da proposta na API principal
    if (proposalId.includes('_')) {
      console.log(`🔍 [Proposal Accept] ProposalId is composite format, need to find real proposal ID`);
      
      try {
        // Busca todas as propostas deste boosting request
        const proposalsUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api'}/boosting-requests/${boostingId}/proposals`;
        console.log(`🔗 [Proposal Accept] Fetching proposals from: ${proposalsUrl}`);
        
        const proposalsResponse = await axios.get(proposalsUrl, {
          headers: { Authorization: req.headers.authorization }
        });
        
        const proposals = proposalsResponse.data.data || proposalsResponse.data.proposals || [];
        console.log(`✅ [Proposal Accept] Found ${proposals.length} proposals for boosting ${boostingId}`);
        
        // Encontra a proposta do booster correto (boosterId já normalizado no início)
        const boosterIdStr = String(boosterId);
        console.log(`🔍 [Proposal Accept] Looking for proposal from booster: ${boosterIdStr}`);
        
        const matchingProposal = proposals.find(p => {
          const proposalBoosterId = String(p.boosterId?._id || p.boosterId || p.booster?._id || p.booster);
          console.log(`🔍 [Proposal Accept] Comparing ${proposalBoosterId} === ${boosterIdStr}`);
          return proposalBoosterId === boosterIdStr;
        });
        
        if (matchingProposal) {
          actualProposalId = String(matchingProposal._id || matchingProposal.id);
          console.log(`✅ [Proposal Accept] Found matching proposal ID: ${actualProposalId} for booster ${boosterIdStr}`);
        } else {
          console.error(`❌ [Proposal Accept] No matching proposal found for booster ${boosterIdStr}`);
          console.log(`🔍 [Proposal Accept] Available proposals:`, proposals.map(p => ({
            id: p._id || p.id,
            boosterId: p.boosterId?._id || p.boosterId || p.booster?._id || p.booster,
            status: p.status
          })));
          
          // Se não encontrou, retorna erro ao invés de continuar
          return res.status(404).json({
            success: false,
            message: 'Proposta não encontrada para este booster',
            details: {
              boostingId,
              boosterId: boosterIdStr,
              availableProposals: proposals.map(p => ({
                id: p._id || p.id,
                boosterId: p.boosterId?._id || p.boosterId,
                status: p.status
              }))
            }
          });
        }
      } catch (error) {
        console.log('❌ [Proposal Accept] Error fetching proposals:', error.message);
        console.log('❌ [Proposal Accept] Error details:', error.response?.data);
      }
    }
    
    // Se ainda não temos actualProposalId, verifica conversation metadata
    if (!actualProposalId || actualProposalId.includes('_')) {
      console.log(`🔍 [Proposal Accept] Checking conversation metadata for proposal ID`);
      
      try {
        const conversationResponse = await axios.get(`https://zenith.enrelyugi.com.br/api/conversations/${conversationId}`, {
          headers: { Authorization: req.headers.authorization }
        });
        
        const conversationData = conversationResponse.data;
        console.log('🔍 [Proposal Accept] Conversation metadata:', JSON.stringify(conversationData?.metadata, null, 2));
        
        // Não usa metadata.proposalId se for formato composto
        if (conversationData?.metadata?.actualProposalId) {
          actualProposalId = conversationData.metadata.actualProposalId;
          console.log('✅ [Proposal Accept] Found actualProposalId from conversation:', actualProposalId);
        }
      } catch (error) {
        console.log('❌ [Proposal Accept] Error fetching conversation metadata:', error.message);
      }
    }
    
    // Aceita proposta localmente primeiro (sistema híbrido)
    console.log('📝 [Proposal Accept] Accepting proposal locally in Chat API...');
    
    let acceptedConv = null;
    let agreementCreated = null;
    
    try {
      // 1. Buscar conversa
      if (conversationId) {
        acceptedConv = await Conversation.findById(conversationId);
      }
      if (!acceptedConv) {
        acceptedConv = await Conversation.findOne({
          isTemporary: true,
          $or: [
            { 'metadata.proposalId': proposalId },
            { 'metadata.proposalId': actualProposalId },
            { proposal: proposalId },
            { proposal: actualProposalId }
          ]
        });
      }

      if (!acceptedConv) {
        throw new Error('Conversa não encontrada para aceitar proposta');
      }

      console.log('✅ [Proposal Accept] Conversation found:', acceptedConv._id);
      
      // 2. ✅ CRÍTICO: Criar Agreement ANTES de aceitar a conversa
      try {
          console.log('📝 [Proposal Accept] Creating Agreement for conversation...');
          
          // Verifica se já existe Agreement
          const existingAgreement = await Agreement.findOne({ conversationId });
          
          if (!existingAgreement) {
            console.log('🔍 [Proposal Accept] Agreement does not exist, creating new one...');
            console.log('🔍 [Proposal Accept] Creating Agreement with:', {
              conversationId,
              actualProposalId,
              clientId,
              boosterId,
              hasMetadata: !!metadata,
              hasProposalData: !!metadata?.proposalData
            });
            
            // Busca dados do cliente e booster
            const clientUser = await require('../models/User').findById(clientId);
            const boosterUser = await require('../models/User').findById(boosterId);
            
            console.log('🔍 [Proposal Accept] Users found:', {
              clientUser: !!clientUser,
              boosterUser: !!boosterUser,
              clientName: clientUser?.name,
              boosterName: boosterUser?.name
            });
            
            if (!clientUser) {
              throw new Error(`Client user not found: ${clientId}`);
            }
            if (!boosterUser) {
              throw new Error(`Booster user not found: ${boosterId}`);
            }
            
            if (clientUser && boosterUser) {
              // Extrai dados da proposta (pode estar em metadata.proposalData ou direto no metadata)
              const proposalData = metadata?.proposalData || {};
              const proposalPrice = proposalData.price || metadata?.price || metadata?.proposedPrice || 0;
              
              console.log('🔍 [Proposal Accept] Proposal data extracted:', {
                proposalPrice,
                game: proposalData.game || metadata?.game,
                category: proposalData.category || metadata?.category
              });
              
              if (!proposalPrice || proposalPrice <= 0) {
                throw new Error(`Invalid proposal price: ${proposalPrice}`);
              }
              
              // Validar e converter proposalId para ObjectId válido
              const mongoose = require('mongoose');
              let validProposalId;
              
              if (mongoose.Types.ObjectId.isValid(actualProposalId) && !actualProposalId.includes('_')) {
                validProposalId = actualProposalId;
                console.log('✅ [Proposal Accept] Using actualProposalId as ObjectId:', validProposalId);
              } else if (mongoose.Types.ObjectId.isValid(boostingId)) {
                validProposalId = boostingId;
                console.log('✅ [Proposal Accept] ProposalId is composite, using boostingId:', validProposalId);
              } else {
                validProposalId = conversationId;
                console.log('⚠️ [Proposal Accept] Using conversationId as fallback:', validProposalId);
              }
              
              const agreement = new Agreement({
                conversationId,
                proposalId: validProposalId,
                proposalSnapshot: {
                  game: proposalData.game || metadata?.game || 'N/A',
                  category: proposalData.category || metadata?.category || metadata?.boostingCategory || 'Boosting',
                  currentRank: proposalData.currentRank || metadata?.currentRank || 'N/A',
                  desiredRank: proposalData.desiredRank || metadata?.desiredRank || 'N/A',
                  description: proposalData.description || metadata?.description || '',
                  price: proposalPrice,
                  originalPrice: proposalPrice,
                  estimatedTime: proposalData.estimatedTime || metadata?.estimatedTime || ''
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
              
              agreement.addAction('created', clientId, { proposalId: actualProposalId });
              await agreement.save();
              
              // Atualiza conversa com agreementId
              acceptedConv.metadata = acceptedConv.metadata || new Map();
              acceptedConv.metadata.set('latestAgreementId', agreement.agreementId);
              await acceptedConv.save();
              
              console.log(`✅ [Proposal Accept] Agreement created: ${agreement.agreementId}`);
              console.log('✅ [Proposal Accept] Agreement saved successfully with conversationId:', conversationId);
              
              // ✅ NOVO: DEBITAR cliente imediatamente (ESCROW) ao aceitar proposta
              try {
                console.log('💰 [Proposal Accept] Debitando cliente (escrow)...');
                
                const User = require('../models/User');
                const WalletLedger = require('../models/WalletLedger');
                const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
                
                // Buscar cliente novamente para ter saldo atualizado
                const clientForDebit = await User.findById(clientId);
                const clientBalanceBefore = round2(clientForDebit.walletBalance || 0);
                
                // Verificar saldo suficiente
                if (clientBalanceBefore < proposalPrice) {
                  throw new Error(`Saldo insuficiente. Necessário: R$ ${proposalPrice.toFixed(2)}, Disponível: R$ ${clientBalanceBefore.toFixed(2)}`);
                }
                
                const clientBalanceAfter = round2(clientBalanceBefore - proposalPrice);
                clientForDebit.walletBalance = clientBalanceAfter;
                await clientForDebit.save();
                
                // Criar registro no WalletLedger (cliente - débito escrow)
                await WalletLedger.create({
                  userId: clientId,
                  txId: null,
                  direction: 'debit',
                  reason: 'boosting_escrow',
                  amount: proposalPrice,
                  operationId: `boosting_escrow:${agreement._id}`,
                  balanceBefore: clientBalanceBefore,
                  balanceAfter: clientBalanceAfter,
                  metadata: {
                    source: 'boosting',
                    agreementId: agreement._id.toString(),
                    conversationId: conversationId,
                    boosterId: boosterId.toString(),
                    price: Number(proposalPrice),
                    feePercent: 0.05,
                    type: 'boosting_service',
                    serviceName: 'Serviço de Boosting',
                    providerName: boosterUser.name || 'Booster',
                    status: 'escrowed' // ✅ Indica que está em escrow
                  }
                });
                
                // Atualizar Agreement para indicar que pagamento foi reservado
                agreement.financial.paymentStatus = 'escrowed';
                await agreement.save();
                
                console.log('✅ [Proposal Accept] Cliente debitado (escrow):', {
                  clientId: clientId.toString(),
                  amount: proposalPrice,
                  balanceBefore: clientBalanceBefore,
                  balanceAfter: clientBalanceAfter,
                  status: 'escrowed'
                });
              } catch (escrowError) {
                console.error('❌ [Proposal Accept] Erro ao debitar cliente (escrow):', escrowError.message);
                
                // Reverter Agreement se débito falhou
                await Agreement.deleteOne({ _id: agreement._id });
                
                throw new Error(`Erro ao processar pagamento: ${escrowError.message}`);
              }
              
              agreementCreated = agreement;
            } else {
              console.warn('⚠️ [Proposal Accept] Client or Booster user not found for Agreement creation');
            }
          } else {
            console.log(`ℹ️ [Proposal Accept] Agreement already exists: ${existingAgreement.agreementId}`);
            agreementCreated = existingAgreement;
          }
      } catch (agreementError) {
        console.error('❌ [Proposal Accept] CRITICAL ERROR creating Agreement:', agreementError.message);
        console.error('❌ [Proposal Accept] Stack trace:', agreementError.stack);
        console.error('❌ [Proposal Accept] This will prevent delivery confirmation!');
        
        // Log dados detalhados para debug
        console.error('❌ [Proposal Accept] Failed with data:', {
          conversationId,
          actualProposalId,
          clientId,
          boosterId,
          metadata: JSON.stringify(metadata, null, 2)
        });
        
        // ⚠️ IMPORTANTE: Agreement é CRÍTICO para confirmação de entrega
        // Propagar erro para impedir aceitação
        throw agreementError;
      }
      
      // 3. Somente APÓS criar Agreement, aceitar a conversa
      acceptedConv.isTemporary = false;
      acceptedConv.status = 'accepted';
      acceptedConv.expiresAt = null;
      acceptedConv.boostingStatus = 'active';
      await acceptedConv.save();
      console.log('✅ [Proposal Accept] Conversation accepted locally:', acceptedConv._id);
      
    } catch (localError) {
      console.error('❌ [Proposal Accept] FATAL ERROR accepting locally:', localError.message);
      console.error('❌ [Proposal Accept] Stack:', localError.stack);
      
      // ⚠️ RETORNAR ERRO para o cliente - NÃO continuar se Agreement falhou
      return res.status(500).json({
        success: false,
        message: 'Erro crítico ao aceitar proposta. Por favor, tente novamente.',
        error: localError.message,
        details: 'O Agreement não pôde ser criado. Isso é necessário para confirmar a entrega posteriormente.'
      });
    }
    
    // Tenta sincronizar com API principal (não-bloqueante)
    let apiResponse = null;
    let apiSyncSuccess = false;
    
    // Se proposalId ainda está no formato composto, usa o boostingId
    const finalProposalId = actualProposalId.includes('_') ? boostingId : actualProposalId;
    
    try {
      const forwardUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api'}/boosting-requests/${boostingId}/proposals/${finalProposalId}/accept`;
      
      console.log(`🔗 [Proposal Accept] Attempting sync with main API: ${forwardUrl}`);
      console.log(`🔗 [Proposal Accept] Final IDs: boostingId=${boostingId}, proposalId=${finalProposalId}`);
      
      apiResponse = await axios.post(forwardUrl, {
        conversationId,
        boosterId,
        clientId,
        metadata
      }, {
        headers: {
          'Authorization': req.headers.authorization,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10s timeout
      });
      
      console.log(`✅ [Proposal Accept] Main API sync successful:`, apiResponse.data);
      apiSyncSuccess = true;
      
    } catch (apiError) {
      console.warn('⚠️ [Proposal Accept] Main API sync failed (continuing anyway):', apiError.message);
      if (apiError.response) {
        console.warn('⚠️ [Proposal Accept] API Error:', apiError.response.status, apiError.response.data);
      }
      // Continua mesmo com erro na API principal
    }
    // Emite eventos WebSocket para atualização em tempo real
    try {
      const webSocketServer = req.app.get('webSocketServer');
      if (webSocketServer) {
        console.log('📡 [Proposal Accept] Emitting WebSocket events for real-time updates...');
        
        // Dados da proposta aceita
        const acceptedProposalData = apiSyncSuccess && apiResponse?.data?.acceptedProposal 
          ? apiResponse.data.acceptedProposal 
          : {
              proposalId: actualProposalId,
              boostingId: boostingId,
              boosterId: boosterId,
              clientId: clientId,
              status: 'accepted',
              acceptedAt: new Date().toISOString()
            };
        
        // Evento 1: proposal:accepted
        const proposalAcceptedEvent = {
          type: 'proposal:accepted',
          data: {
            conversationId,
            proposalId: actualProposalId,
            boostingId,
            acceptedProposal: acceptedProposalData,
            status: 'accepted',
            acceptedAt: new Date().toISOString(),
            acceptedBy: 'client',
            clientId,
            boosterId
          }
        };
        
        if (clientId) {
          webSocketServer.sendToUser(clientId, proposalAcceptedEvent);
          console.log(`✅ [Proposal Accept] 'proposal:accepted' sent to client: ${clientId}`);
        }
        
        if (boosterId) {
          webSocketServer.sendToUser(boosterId, proposalAcceptedEvent);
          console.log(`✅ [Proposal Accept] 'proposal:accepted' sent to booster: ${boosterId}`);
        }
        
        // Evento 2: conversation:updated (atualiza UI)
        const conversationUpdateEvent = {
          type: 'conversation:updated',
          data: {
            conversationId,
            status: 'accepted',
            isTemporary: false,
            boostingStatus: 'active',
            updatedAt: new Date().toISOString(),
            conversation: acceptedConv ? {
              _id: acceptedConv._id,
              status: acceptedConv.status,
              isTemporary: acceptedConv.isTemporary,
              boostingStatus: acceptedConv.boostingStatus,
              participants: acceptedConv.participants
            } : null
          }
        };
        
        if (clientId) {
          webSocketServer.sendToUser(clientId, conversationUpdateEvent);
          console.log(`✅ [Proposal Accept] 'conversation:updated' sent to client: ${clientId}`);
        }
        
        if (boosterId) {
          webSocketServer.sendToUser(boosterId, conversationUpdateEvent);
          console.log(`✅ [Proposal Accept] 'conversation:updated' sent to booster: ${boosterId}`);
        }
        
        console.log('✅ [Proposal Accept] All WebSocket events emitted successfully');
      } else {
        console.warn('⚠️ [Proposal Accept] WebSocket server not available for real-time updates');
      }
    } catch (wsError) {
      console.error('❌ [Proposal Accept] Error emitting WebSocket events:', wsError);
      console.error('❌ [Proposal Accept] WebSocket error stack:', wsError.stack);
    }
    

    // Retorna resposta apropriada
    if (apiSyncSuccess && apiResponse) {
      console.log('✅ [Proposal Accept] Returning API response');
      return res.json(apiResponse.data);
    } else {
      console.log('✅ [Proposal Accept] Returning local acceptance response');
      return res.json({
        success: true,
        message: 'Proposta aceita com sucesso',
        acceptedProposal: {
          proposalId: proposalId,
          actualProposalId: actualProposalId,
          boostingId: boostingId,
          status: 'accepted',
          acceptedAt: new Date().toISOString(),
          conversationId: conversationId,
          boosterId: boosterId,
          clientId: clientId
        },
        conversation: acceptedConv ? {
          _id: acceptedConv._id,
          status: acceptedConv.status,
          isTemporary: acceptedConv.isTemporary,
          boostingStatus: acceptedConv.boostingStatus
        } : null,
        sync: {
          mainApi: apiSyncSuccess,
          warning: !apiSyncSuccess ? 'Main API sync failed, but proposal was accepted locally' : null
        }
      });
    }
    
  } catch (error) {
    console.error('❌ [Proposal Accept] Error:', error.message);
    
    if (error.response) {
      console.error('❌ [Proposal Accept] API Error Response:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    
    return res.status(500).json({
      success: false,
      message: 'Erro interno do servidor ao aceitar proposta',
      error: error.message
    });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');

const axios = require('axios');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Agreement = require('../models/Agreement');
const AcceptedProposal = require('../models/AcceptedProposal');
const User = require('../models/User');
const { calculateAndSendEscrowUpdate } = require('./walletRoutes');


router.get('/', (req, res) => {
  res.json({
    message: 'Proposals API',
    endpoints: {
      accept: 'POST /:proposalId/accept'
    },
    timestamp: new Date().toISOString()
  });
});


function normalizeApiBase(url) {
  return (url || 'https://zenithggapi.vercel.app/api').replace(/\/$/, '');
}

async function fetchUserFromMainAPI(userId, roleLabel, authHeader) {
  const baseUrl = normalizeApiBase(process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api');
  const url = `${baseUrl}/users/${userId}`;
  try {
    const headers = authHeader ? { Authorization: authHeader } : {};
    const response = await axios.get(url, {
      headers,
      timeout: 10000
    });
    return response.data?.user || response.data?.data || response.data;
  } catch (error) {
    logger.error(`[Proposals] Erro ao buscar ${roleLabel} ${userId} na API principal`, {
      status: error.response?.status,
      message: error.message
    });
    throw new Error(`${roleLabel} ${userId} não encontrado na API principal`);
  }
}

async function ensureLocalUser(userId, roleLabel, authHeader) {
  if (!userId) {
    throw new Error(`${roleLabel} ID inválido`);
  }

  const idStr = String(userId);
  let userDoc = null;

  if (mongoose.Types.ObjectId.isValid(idStr)) {
    userDoc = await User.findById(idStr);
  }

  if (!userDoc) {
    userDoc = await User.findOne({ userid: idStr });
  }

  if (!userDoc) {
    const apiUser = await fetchUserFromMainAPI(idStr, roleLabel, authHeader);
    if (!apiUser) {
      throw new Error(`${roleLabel} ${idStr} não pôde ser sincronizado`);
    }

    const payload = {
      userid: apiUser.userid || idStr,
      name: apiUser.name || apiUser.username || roleLabel,
      email: apiUser.email || `user${idStr}@hacklote.com`,
      avatar: apiUser.avatar || null,
      profileImage: apiUser.avatar || null,
      walletBalance: apiUser.walletBalance || 0
    };

    userDoc = new User(payload);
    try {
      await userDoc.save();
    } catch (error) {
      if (error.code === 11000) {
        userDoc = await User.findOne({ email: payload.email }) || await User.findOne({ userid: payload.userid });
      } else {
        throw error;
      }
    }
  } else if (!userDoc.userid && !mongoose.Types.ObjectId.isValid(idStr)) {
    userDoc.userid = idStr;
    await userDoc.save();
  }

  return userDoc;
}


router.get('/:proposalId/accept', auth, async (req, res) => {
  try {
    const { proposalId } = req.params;
    
    // GET method not allowed
    
    res.status(405).json({
      success: false,
      message: 'Method Not Allowed. Use POST method to accept proposals.',
      allowedMethods: ['POST'],
      endpoint: `POST /api/proposals/${proposalId}/accept`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    // GET error
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
    
    // 🔍 DEBUG: Log do body ANTES da desestruturação
    console.log(`\n📥 REQUEST RECEBIDO /proposals/${proposalId}/accept`);
    console.log(`📋 req.body RAW:`, req.body);
    console.log(`📋 req.body type:`, typeof req.body);
    console.log(`📋 req.body stringified:`, JSON.stringify(req.body, null, 2));
    
    let { conversationId, boosterId, clientId, metadata = {} } = req.body;
    
    // 🔍 DEBUG: Log após desestruturação
    console.log(`📋 conversationId extraído:`, conversationId);
    console.log(`📋 boosterId extraído:`, boosterId);
    console.log(`📋 clientId extraído:`, clientId);
    console.log(`📋 metadata extraído:`, JSON.stringify(metadata, null, 2));
    
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
    
    // Converte IDs para string (podem vir como números)
    if (boosterId) {
      boosterId = String(boosterId);
    }
    if (clientId) {
      clientId = String(clientId);
    }

    const clientExternalId = clientId;
    const boosterExternalId = boosterId;
    
    // conversationId agora é obrigatório: se não veio nem no body nem no metadata, falha imediatamente
    if (!conversationId && metadata?.conversationId) {
      conversationId = metadata.conversationId;
      console.log(`⚠️ conversationId extraído do metadata:`, conversationId);
    }

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: 'conversationId é obrigatório para aceitar proposta',
        error: 'MISSING_CONVERSATION_ID'
      });
    }

    // Request received - removed info log for performance
    

    if (metadata?.proposalId) {
      actualProposalId = metadata.proposalId;
      // Using proposalId from metadata
    }
    
    if (!boostingId) {
      // Attempting boostingId lookup
      
      try {
        const proposalLookupUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api'}/proposals/${proposalId}/boosting-id`;
        
        const lookupResponse = await axios.get(proposalLookupUrl, {
          headers: { Authorization: req.headers.authorization }
        });
        
        lookupData = lookupResponse.data;
        boostingId = lookupResponse.data.boostingId;
        
        if (lookupResponse.data.actualProposalId) {
          actualProposalId = lookupResponse.data.actualProposalId;
          // Using actualProposalId from lookup
        }
      } catch (lookupError) {
        // Lookup failed
        
        const mongoose = require('mongoose');
        if (mongoose.Types.ObjectId.isValid(proposalId)) {
          // Using proposalId as boostingId
          boostingId = proposalId;
        } else {
          // Invalid proposalId
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
    
    if (!boostingId || boostingId === 'undefined') {
      // Invalid boostingId
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
      // Composite proposalId, fetching from API
      
      try {
        const proposalsUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api'}/boosting-requests/${boostingId}/proposals`;
        
        const proposalsResponse = await axios.get(proposalsUrl, {
          headers: { Authorization: req.headers.authorization }
        });
        
        const proposals = proposalsResponse.data.data || proposalsResponse.data.proposals || [];
        
        const boosterIdStr = String(boosterId);
        const matchingProposal = proposals.find(p => {
          const proposalBoosterId = String(p.boosterId?._id || p.boosterId || p.booster?._id || p.booster);
          return proposalBoosterId === boosterIdStr;
        });
        
        if (matchingProposal) {
          actualProposalId = String(matchingProposal._id || matchingProposal.id);
          // Found matching proposal
        } else {
          // No matching proposal
          
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
        // Error fetching proposals
      }
    }
    
    // Se ainda não temos actualProposalId, verifica conversation metadata
    if (!actualProposalId || actualProposalId.includes('_')) {
      try {
        const conversationResponse = await axios.get(`https://zenith.enrelyugi.com.br/api/conversations/${conversationId}`, {
          headers: { Authorization: req.headers.authorization }
        });
        
        const conversationData = conversationResponse.data;
        
        if (conversationData?.metadata?.actualProposalId) {
          actualProposalId = conversationData.metadata.actualProposalId;
          // Found actualProposalId from conversation
        }
      } catch (error) {
        // Error fetching conversation metadata
      }
    }
    
    // Accepting proposal locally
    
    let acceptedConv = null;
    let agreementCreated = null;
    let clientUser = null;
    let boosterUser = null;
    let clientDbId = null;
    let boosterDbId = null;
    const authHeader = req.headers.authorization;
    
    try {
      // 1. Buscar conversa EXCLUSIVAMENTE pelo conversationId informado
      acceptedConv = await Conversation.findById(conversationId);

      if (!acceptedConv) {
        throw new Error('Conversa não encontrada para aceitar proposta');
      }

      // Conversation found
      
      // 2. CRÍTICO: Criar Agreement ANTES de aceitar a conversa
      try {
          // Verifica se já existe Agreement
          const existingAgreement = await Agreement.findOne({ conversationId });
          
          if (!existingAgreement) {
            
            console.log(`\n🔍 Iniciando busca de usuários...`);
            console.log(`📋 Cliente ID (externo): ${clientId}`);
            console.log(`📋 Booster ID (externo): ${boosterId}`);

            clientUser = await ensureLocalUser(clientId, 'Cliente', authHeader);
            boosterUser = await ensureLocalUser(boosterId, 'Booster', authHeader);

            clientDbId = clientUser._id.toString();
            boosterDbId = boosterUser._id.toString();
            
            if (!clientUser) {
              console.error(`❌ ERRO CRÍTICO: Cliente ${clientId} não encontrado`);
              throw new Error(`Client user not found: ${clientId}`);
            }
            if (!boosterUser) {
              console.error(`❌ ERRO CRÍTICO: Booster ${boosterId} não encontrado`);
              throw new Error(`Booster user not found: ${boosterId}`);
            }
            
            console.log(`✅ Ambos usuários encontrados - prosseguindo com Agreement...`);
            
            if (clientUser && boosterUser) {
              const clientLegacyId = clientUser.userid || clientExternalId;
              const boosterLegacyId = boosterUser.userid || boosterExternalId;
              // Extrai dados da proposta (pode estar em metadata.proposalData ou direto no metadata)
              let proposalData = metadata?.proposalData || {};
              let proposalPrice = proposalData.price || metadata?.price || metadata?.proposedPrice || 0;
              
              // Se preço não foi passado no metadata, busca da API principal
              if (!proposalPrice || proposalPrice <= 0) {
                console.log(`⚠️ Preço não encontrado no metadata, buscando proposta na API...`);
                console.log(`📋 Proposal ID: ${actualProposalId}`);
                console.log(`📋 Boosting ID: ${boostingId}`);
                
                try {
                  // Busca a proposta completa da API principal
                  const proposalUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api'}/boosting-requests/${boostingId}/proposals/${actualProposalId}`;
                  console.log(`📡 URL da proposta: ${proposalUrl}`);
                  
                  const proposalResponse = await axios.get(proposalUrl, {
                    headers: { Authorization: req.headers.authorization },
                    timeout: 10000
                  });
                  
                  console.log(`📦 Resposta da proposta (status ${proposalResponse.status}):`, JSON.stringify(proposalResponse.data, null, 2));
                  
                  let proposal = proposalResponse.data?.proposal || proposalResponse.data?.data || proposalResponse.data;
                  
                  // Se a resposta contém orders (lista de boosting requests), extrai o correto pelo ID
                  if (proposal && proposal.orders && Array.isArray(proposal.orders)) {
                    console.log(`📦 Resposta contém ${proposal.orders.length} orders, buscando o correto...`);
                    const matchingOrder = proposal.orders.find(order => 
                      String(order._id) === String(boostingId)
                    );
                    
                    if (matchingOrder) {
                      console.log(`✅ Order encontrado:`, {
                        _id: matchingOrder._id,
                        price: matchingOrder.price,
                        game: matchingOrder.game
                      });
                      proposal = matchingOrder;
                    }
                  }
                  
                  if (proposal && (proposal.price || proposal.proposedPrice || proposal.amount)) {
                    proposalPrice = proposal.price || proposal.proposedPrice || proposal.amount || 0;
                    proposalData = {
                      price: proposalPrice,
                      game: proposal.game || metadata?.game || 'N/A',
                      category: proposal.category || metadata?.category || 'Boosting',
                      currentRank: proposal.currentRank || metadata?.currentRank || 'N/A',
                      desiredRank: proposal.desiredRank || metadata?.desiredRank || 'N/A',
                      description: proposal.description || metadata?.description || '',
                      estimatedTime: proposal.estimatedTime || metadata?.estimatedTime || ''
                    };
                    
                    console.log(`✅ Dados da proposta obtidos da API:`, {
                      price: proposalPrice,
                      game: proposalData.game,
                      category: proposalData.category
                    });
                  } else {
                    // A API retornou orders, não proposals - vamos buscar do boosting request
                    console.log(`⚠️ Resposta retornou orders. Buscando boosting request para extrair preço...`);
                    
                    try {
                      // Busca o boosting request completo
                      const boostingRequestUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api'}/boosting-requests/${boostingId}`;
                      console.log(`📡 URL boosting request: ${boostingRequestUrl}`);
                      
                      const boostingResponse = await axios.get(boostingRequestUrl, {
                        headers: { Authorization: req.headers.authorization },
                        timeout: 10000
                      });
                      
                      console.log(`📦 Boosting request encontrado:`, JSON.stringify(boostingResponse.data).substring(0, 300));
                      
                      const boostingRequest = boostingResponse.data?.data || boostingResponse.data;
                      
                      if (boostingRequest) {
                        // Extrai preço e dados do boosting request
                        proposalPrice = boostingRequest.price || boostingRequest.proposedPrice || 0;
                        proposalData = {
                          price: proposalPrice,
                          game: boostingRequest.game || metadata?.game || 'N/A',
                          category: boostingRequest.category || metadata?.category || 'Boosting',
                          currentRank: boostingRequest.currentRank || 'N/A',
                          desiredRank: boostingRequest.desiredRank || 'N/A',
                          description: boostingRequest.description || '',
                          estimatedTime: boostingRequest.estimatedTime || ''
                        };
                        
                        console.log(`✅ Dados do boosting request:`, {
                          price: proposalPrice,
                          game: proposalData.game,
                          estimatedTime: proposalData.estimatedTime
                        });
                      } else {
                        console.error(`❌ Boosting request não encontrado na resposta`);
                      }
                    } catch (boostingError) {
                      console.error(`❌ Erro ao buscar boosting request:`, {
                        message: boostingError.message,
                        status: boostingError.response?.status
                      });
                    }
                  }
                } catch (apiError) {
                  console.error(`❌ Erro ao buscar proposta da API:`, {
                    message: apiError.message,
                    status: apiError.response?.status,
                    data: apiError.response?.data
                  });
                }
              }
              
              if (!proposalPrice || proposalPrice <= 0) {
                console.error(`❌ ERRO CRÍTICO: Preço inválido após todas tentativas:`, {
                  proposalPrice,
                  metadata,
                  proposalData
                });
                throw new Error(`Invalid proposal price: ${proposalPrice}. Metadata: ${JSON.stringify(metadata)}`);
              }
              
              console.log(`✅ Preço validado: R$ ${proposalPrice.toFixed(2)}`);
              
              // Validar e converter proposalId para ObjectId válido
              const mongoose = require('mongoose');
              let validProposalId;
              
              if (mongoose.Types.ObjectId.isValid(actualProposalId) && !actualProposalId.includes('_')) {
                validProposalId = actualProposalId;
              } else if (mongoose.Types.ObjectId.isValid(boostingId)) {
                validProposalId = boostingId;
              } else {
                validProposalId = conversationId;
              }
              
              // Garantir que conversationId é ObjectId válido
              if (!conversationId) {
                throw new Error('conversationId is required');
              }
              
              let validConversationId;
              if (mongoose.Types.ObjectId.isValid(conversationId)) {
                validConversationId = conversationId;
              } else {
                throw new Error(`Invalid conversationId: ${conversationId}`);
              }
              
              console.log(`📋 IDs validados:`, {
                conversationId: validConversationId,
                proposalId: validProposalId,
                clientId,
                boosterId
              });
              
              const agreement = new Agreement({
                conversationId: validConversationId,
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
              
              agreement.addAction('created', clientDbId, { proposalId: actualProposalId });
              await agreement.save();
              
              // Atualiza conversa com agreementId
              acceptedConv.metadata = acceptedConv.metadata || new Map();
              acceptedConv.metadata.set('latestAgreementId', agreement.agreementId);
              await acceptedConv.save();
              
              // Agreement created
              
              // NOVO: DEBITAR cliente imediatamente (ESCROW) ao aceitar proposta
              try {
                // Debiting client escrow
                
                const User = require('../models/User');
                const WalletLedger = require('../models/WalletLedger');
                const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
                
                const clientForDebit = clientUser;
                
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
                  userId: clientForDebit._id,
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
                    boosterId: boosterDbId,
                    boosterLegacyId: boosterExternalId,
                    legacyClientId: clientExternalId,
                    price: Number(proposalPrice),
                    feePercent: 0.05,
                    type: 'boosting_service',
                    serviceName: 'Serviço de Boosting',
                    providerName: boosterUser.name || 'Booster',
                    status: 'escrowed' // Indica que está em escrow
                  }
                });
                
                // Atualizar Agreement para indicar que pagamento foi reservado
                agreement.financial.paymentStatus = 'escrowed';
                await agreement.save();

                if (boosterUser?._id) {
                  await calculateAndSendEscrowUpdate(req.app, boosterUser._id);
                }
                
                // Client debited (escrow)
              } catch (escrowError) {
                // Escrow debit failed
                
                // Reverter Agreement se débito falhou
                await Agreement.deleteOne({ _id: agreement._id });
                
                throw new Error(`Erro ao processar pagamento: ${escrowError.message}`);
              }
              
              agreementCreated = agreement;
            } else {
              // Client or Booster not found for Agreement
            }
          } else {
            // Agreement already exists
            agreementCreated = existingAgreement;
          }
      } catch (agreementError) {
        // CRITICAL - Agreement creation failed
        
        // ⚠️ IMPORTANTE: Agreement é CRÍTICO para confirmação de entrega
        // Propagar erro para impedir aceitação
        throw agreementError;
      }
      
      // 3. Somente APÓS criar Agreement, aceitar a conversa
      acceptedConv.isTemporary = false;
      acceptedConv.status = 'accepted';
      acceptedConv.expiresAt = null;
      acceptedConv.boostingStatus = 'in_progress'; // Alterado de 'active' para 'in_progress' para evitar status inconsistentes
      
      // Armazenar referência ao Agreement criado
      if (!acceptedConv.metadata) acceptedConv.metadata = {};
      acceptedConv.metadata.agreementCreated = true;
      acceptedConv.metadata.agreementId = agreementCreated?._id?.toString();
      
      await acceptedConv.save();
      
      // IMPORTANTE: Verificar se já existe outra conversa para o mesmo acordo/boosting para evitar duplicação
      try {
        // 1) Duplicata baseada em latestAgreementId (fluxos antigos que já usavam agreement)
        const duplicateCheck = await Conversation.findOne({
          _id: { $ne: acceptedConv._id },
          'metadata.latestAgreementId': agreementCreated?.agreementId,
          isActive: true
        });
        
        if (duplicateCheck) {
          console.warn(`⚠️ Detectada conversa duplicada para o mesmo acordo: ${duplicateCheck._id}. Marcando como inativa.`);
          duplicateCheck.isActive = false;
          duplicateCheck.metadata = duplicateCheck.metadata || {};
          duplicateCheck.metadata.deactivationReason = 'Conversa duplicada durante aceitação de proposta';
          duplicateCheck.metadata.primaryConversationId = acceptedConv._id;
          await duplicateCheck.save();
        }

        // 2) Duplicatas legadas para o mesmo boosting (primeiro boosting aceito)
        if (boostingId && acceptedConv.participants && acceptedConv.participants.length >= 2) {
          const participantIds = acceptedConv.participants.map(p => p.toString());

          const legacyDuplicates = await Conversation.find({
            _id: { $ne: acceptedConv._id },
            participants: { $all: participantIds },
            isGroupChat: false,
            isActive: true,
            $or: [
              { 'metadata.relatedBoostingId': boostingId.toString() },
              { 'metadata.boostingId': boostingId.toString() }
            ]
          });

          for (const dup of legacyDuplicates) {
            console.warn(`⚠️ Detectada conversa legada duplicada para o mesmo boosting (${boostingId}): ${dup._id}. Marcando como inativa.`);
            dup.isActive = false;
            dup.metadata = dup.metadata || {};
            dup.metadata.deactivationReason = 'Conversa duplicada (legacy) para o mesmo boosting durante aceitação de proposta';
            dup.metadata.primaryConversationId = acceptedConv._id;
            await dup.save();
          }
        }
      } catch (dupErr) {
        console.error('Erro ao verificar conversas duplicadas:', dupErr);
      }
      // Conversation accepted locally
      
    } catch (localError) {
      // FATAL ERROR accepting locally
      
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

      // Syncing with main API (non-blocking for local acceptance)
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

      // Main API sync successful
      apiSyncSuccess = true;

    } catch (apiError) {
      // Main API sync failed (continuing with local acceptance only)
      console.warn('⚠️ Failed to sync accepted proposal with main API:', apiError.message);
    }

    // Emite eventos WebSocket para atualização em tempo real via Chat WS
    try {
      const webSocketServer = req.app.get('webSocketServer');
      if (webSocketServer && acceptedConv) {
        const participantIds = (acceptedConv.participants || [])
          .map((p) => {
            if (!p) return null;
            if (p._id && p._id.toString) return p._id.toString();
            if (p.toString) return p.toString();
            return String(p);
          })
          .filter(Boolean);

        if (participantIds.length > 0) {
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

          const conversationUpdateEvent = {
            type: 'conversation:updated',
            data: {
              conversationId,
              status: 'accepted',
              isTemporary: false,
              boostingStatus: 'in_progress',
              updatedAt: new Date().toISOString(),
              conversation: {
                _id: acceptedConv._id,
                status: acceptedConv.status,
                isTemporary: acceptedConv.isTemporary,
                boostingStatus: acceptedConv.boostingStatus,
                participants: acceptedConv.participants,
                metadata: {
                  agreementId: agreementCreated?.agreementId,
                  proposalId: actualProposalId
                }
              }
            }
          };

          participantIds.forEach((uid) => {
            webSocketServer.sendToUser(uid, proposalAcceptedEvent);
            webSocketServer.sendToUser(uid, conversationUpdateEvent);
          });
        }
      }
    } catch (wsError) {
      console.error('❌ Error emitting WebSocket events for accepted proposal:', wsError.message);
    }

    // Retorna resposta apropriada
    if (apiSyncSuccess && apiResponse) {
      // Returning API response
      return res.json(apiResponse.data);
    } else {
      // Returning local response
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
          boostingStatus: acceptedConv.boostingStatus,
          agreementId: agreementCreated?.agreementId
        } : null,
        agreement: agreementCreated ? {
          _id: agreementCreated._id,
          agreementId: agreementCreated.agreementId,
          status: agreementCreated.status,
          price: agreementCreated.proposalSnapshot?.price
        } : null,
        sync: {
          mainApi: apiSyncSuccess,
          warning: !apiSyncSuccess ? 'Main API sync failed, but proposal was accepted locally' : null
        }
      });
    }
    
  } catch (error) {
    // Unhandled error
    
    if (error.response) {
      // API Error
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

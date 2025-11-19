const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');

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
    
    // 🔧 FALLBACK: Se conversationId não veio no body, tenta extrair do metadata ou buscar conversa
    if (!conversationId && metadata?.conversationId) {
      conversationId = metadata.conversationId;
      console.log(`⚠️ conversationId extraído do metadata:`, conversationId);
    }
    
    // 🔧 FALLBACK 2: Se ainda não tem conversationId, busca conversa pelo proposalId
    if (!conversationId) {
      console.log(`⚠️ conversationId ausente, buscando conversa pelo proposalId...`);
      try {
        const Conversation = require('../models/Conversation');
        const foundConv = await Conversation.findOne({
          isTemporary: true,
          status: 'temporary',
          $or: [
            { 'metadata.proposalId': actualProposalId },
            { 'metadata.proposalId': proposalId },
            { proposal: actualProposalId },
            { proposal: proposalId }
          ]
        });
        
        if (foundConv) {
          conversationId = foundConv._id.toString();
          console.log(`✅ conversationId encontrado pela conversa:`, conversationId);
        } else {
          console.error(`❌ Nenhuma conversa encontrada para proposalId: ${proposalId}/${actualProposalId}`);
        }
      } catch (convError) {
        console.error(`❌ Erro ao buscar conversa:`, convError.message);
      }
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

      // Conversation found
      
      // 2. CRÍTICO: Criar Agreement ANTES de aceitar a conversa
      try {
          // Verifica se já existe Agreement
          const existingAgreement = await Agreement.findOne({ conversationId });
          
          if (!existingAgreement) {
            
            // Busca dados do cliente e booster
            const mongoose = require('mongoose');
            const User = require('../models/User');
            
            // Função auxiliar para buscar usuário (local ou API principal)
            const fetchUser = async (userId, userType = 'user') => {
              // Tenta buscar localmente primeiro
              let user;
              if (mongoose.Types.ObjectId.isValid(userId) && userId.length === 24) {
                user = await User.findById(userId);
                if (user) {
                  console.log(`✅ ${userType} ${userId} encontrado no MongoDB local`);
                  return user;
                }
              }
              
              // Se não encontrou localmente, busca na API principal
              console.log(`🔍 Buscando ${userType} ${userId} na API principal...`);
              
              try {
                const apiUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api'}/users/${userId}`;
                console.log(`📡 URL da API: ${apiUrl}`);
                
                const userResponse = await axios.get(apiUrl, {
                  headers: { Authorization: req.headers.authorization },
                  timeout: 10000
                });
                
                console.log(`📦 Resposta da API (status ${userResponse.status}):`, JSON.stringify(userResponse.data).substring(0, 200));
                
                // Tenta múltiplos formatos de resposta
                const userData = userResponse.data?.user || userResponse.data?.data || userResponse.data;
                
                if (userData && (userData.id || userData._id || userData.userid)) {
                  console.log(`✅ ${userType} encontrado na API principal:`, userData.name || userData.username);
                  
                  return {
                    _id: userId,
                    name: userData.name || userData.username || 'Usuário',
                    email: userData.email || `user${userId}@hacklote.com`,
                    avatar: userData.avatar || null,
                    rating: userData.rating || 0,
                    isVerified: userData.isVerified || false,
                    totalBoosts: userData.totalBoosts || 0,
                    completedBoosts: userData.completedBoosts || 0,
                    totalOrders: userData.totalOrders || 0,
                    walletBalance: userData.walletBalance || 0
                  };
                }
                
                console.error(`❌ ${userType} ${userId} não encontrado na resposta da API`);
              } catch (apiError) {
                console.error(`❌ Erro ao buscar ${userType} ${userId} na API:`, {
                  message: apiError.message,
                  status: apiError.response?.status,
                  data: apiError.response?.data
                });
              }
              
              return null;
            };
            
            // Busca cliente e booster com logs identificados
            console.log(`\n🔍 Iniciando busca de usuários...`);
            console.log(`📋 Cliente ID: ${clientId}`);
            console.log(`📋 Booster ID: ${boosterId}`);
            
            const clientUser = await fetchUser(clientId, 'Cliente');
            const boosterUser = await fetchUser(boosterId, 'Booster');
            
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
              
              agreement.addAction('created', clientId, { proposalId: actualProposalId });
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
                
                // Buscar cliente novamente para ter saldo atualizado
                // IMPORTANTE: Só pode debitar se usuário existe localmente no MongoDB
                let clientForDebit;
                if (mongoose.Types.ObjectId.isValid(clientId) && clientId.length === 24) {
                  clientForDebit = await User.findById(clientId);
                }
                
                if (!clientForDebit) {
                  // Se cliente não existe localmente, não pode debitar
                  // Escrow será processado pela API principal
                  console.warn(`Cliente ${clientId} não encontrado localmente - escrow delegado à API principal`);
                  throw new Error(`Débito de escrow delegado à API principal para cliente: ${clientId}`);
                }
                
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
                    status: 'escrowed' // Indica que está em escrow
                  }
                });
                
                // Atualizar Agreement para indicar que pagamento foi reservado
                agreement.financial.paymentStatus = 'escrowed';
                await agreement.save();
                
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
      
      // IMPORTANTE: Verificar se já existe outra conversa para o mesmo acordo para evitar duplicação
      try {
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
      
      // Syncing with main API
      
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
      // Main API sync failed (continuing)
      // Continua mesmo com erro na API principal
    }
    // Emite eventos WebSocket para atualização em tempo real
    try {
      const webSocketServer = req.app.get('webSocketServer');
      if (webSocketServer) {
        // Emitting WebSocket events
        
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
        }
        
        if (boosterId) {
          webSocketServer.sendToUser(boosterId, proposalAcceptedEvent);
        }
        
        // Evento 2: conversation:updated (atualiza UI)
        const conversationUpdateEvent = {
          type: 'conversation:updated',
          data: {
            conversationId,
            status: 'accepted',
            isTemporary: false,
            boostingStatus: 'in_progress', // Alterado de 'active' para 'in_progress' para manter consistência
            updatedAt: new Date().toISOString(),
            conversation: acceptedConv ? {
              _id: acceptedConv._id,
              status: acceptedConv.status,
              isTemporary: acceptedConv.isTemporary,
              boostingStatus: acceptedConv.boostingStatus,
              participants: acceptedConv.participants,
              // Incluir informações do agreement para facilitar rastreamento
              metadata: {
                agreementId: agreementCreated?.agreementId,
                proposalId: actualProposalId
              }
            } : null
          }
        };
        
        if (clientId) {
          webSocketServer.sendToUser(clientId, conversationUpdateEvent);
        }
        
        if (boosterId) {
          webSocketServer.sendToUser(boosterId, conversationUpdateEvent);
        }
        
        // WebSocket events emitted successfully
        
        // ✅ BROADCAST VIA PROPOSAL HANDLER - Notifica todos os subscribers
        try {
          const proposalHandler = req.app.get('proposalHandler');
          if (proposalHandler && boostingId) {
            proposalHandler.broadcastProposalAccepted(
              boostingId,
              actualProposalId,
              conversationId
            );
            console.log(`✅ [ProposalRoutes] Broadcast de proposta aceita enviado para boostingId: ${boostingId}`);
          }
        } catch (broadcastError) {
          console.error(`❌ [ProposalRoutes] Erro ao fazer broadcast:`, broadcastError.message);
        }
        
      } else {
        console.warn(`⚠️ [ProposalRoutes] WebSocket server não disponível`);
      }
    } catch (wsError) {
      console.error(`❌ [ProposalRoutes] Erro ao emitir eventos WebSocket:`, wsError.message);
    }
    
    // ✅ Pequeno delay para garantir que o broadcast foi processado
    await new Promise(resolve => setTimeout(resolve, 100));

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

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');


const axios = require('axios');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');


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

        const proposalLookupUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithapi-steel.vercel.app/api'}/proposals/${proposalId}/boosting-id`;
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
              lookupUrl: `${process.env.HACKLOTE_API_URL || 'https://zenithapi-steel.vercel.app/api'}/proposals/${proposalId}/boosting-id`,
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


    // PRODUÇÃO: Se proposalId é formato composto, buscar ID real
    if (proposalId.includes('_')) {
      console.log(`🔍 [Proposal Accept] Composite format detected, fetching real proposal ID`);
      
      try {
        // Busca propostas do boosting na API principal
        const proposalsUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithapi-steel.vercel.app/api'}/boosting-requests/${boostingId}/proposals`;
        console.log(`🔗 [Proposal Accept] GET ${proposalsUrl}`);
        
        const proposalsResponse = await axios.get(proposalsUrl, {
          headers: { 
            Authorization: req.headers.authorization,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        
        const proposals = proposalsResponse.data.data || proposalsResponse.data.proposals || proposalsResponse.data || [];
        console.log(`📊 [Proposal Accept] API returned ${proposals.length} proposals`);
        
        if (!Array.isArray(proposals) || proposals.length === 0) {
          console.error(`❌ [Proposal Accept] No proposals found for boosting ${boostingId}`);
          return res.status(404).json({
            success: false,
            message: 'Nenhuma proposta encontrada para este boosting',
            details: {
              boostingId,
              proposalsUrl,
              responseStructure: typeof proposalsResponse.data
            }
          });
        }
        
        // Normaliza e encontra proposta do booster
        const normalizedBoosterId = String(boosterId);
        console.log(`🔍 [Proposal Accept] Looking for proposal from booster: ${normalizedBoosterId}`);
        
        const matchingProposal = proposals.find(p => {
          const pBoosterId = String(p.boosterId?._id || p.boosterId || p.booster?._id || p.booster || '');
          const matches = pBoosterId === normalizedBoosterId;
          
          if (matches) {
            console.log(`✅ [Proposal Accept] Match found: ${p._id || p.id}`);
          }
          
          return matches;
        });
        
        if (!matchingProposal) {
          console.error(`❌ [Proposal Accept] No matching proposal for booster ${normalizedBoosterId}`);
          console.log(`📋 [Proposal Accept] Available proposals:`, JSON.stringify(proposals.map(p => ({
            id: p._id || p.id,
            boosterId: String(p.boosterId?._id || p.boosterId || p.booster?._id || p.booster || 'N/A'),
            status: p.status || 'unknown'
          })), null, 2));
          
          return res.status(404).json({
            success: false,
            message: 'Proposta não encontrada para este booster',
            details: {
              boosterId: normalizedBoosterId,
              boostingId,
              availableProposals: proposals.map(p => ({
                id: p._id || p.id,
                boosterId: String(p.boosterId?._id || p.boosterId || '')
              }))
            }
          });
        }
        
        actualProposalId = String(matchingProposal._id || matchingProposal.id);
        console.log(`✅ [Proposal Accept] Real proposal ID: ${actualProposalId}`);
        
      } catch (error) {
        console.error(`❌ [Proposal Accept] Failed to fetch proposals:`, {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });
        
        return res.status(500).json({
          success: false,
          message: 'Erro ao buscar propostas na API principal',
          error: error.message,
          details: {
            boostingId,
            apiStatus: error.response?.status,
            apiError: error.response?.data
          }
        });
      }
    }
    
    // Validação final: proposalId não pode ser formato composto
    if (actualProposalId.includes('_')) {
      console.error(`❌ [Proposal Accept] Invalid proposalId format after resolution: ${actualProposalId}`);
      return res.status(400).json({
        success: false,
        message: 'Não foi possível resolver o ID real da proposta',
        details: {
          originalProposalId: proposalId,
          boostingId,
          boosterId
        }
      });
    }
    
    const forwardUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithapi-steel.vercel.app/api'}/boosting-requests/${boostingId}/proposals/${actualProposalId}/accept`;
    
    console.log(`🔗 [Proposal Accept] Forwarding to: ${forwardUrl}`);
    
    const response = await axios.post(forwardUrl, {
      conversationId,
      boosterId,
      clientId,
      metadata
    }, {
      headers: {
        'Authorization': req.headers.authorization,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ [Proposal Accept] Zenith response:`, response.data);
    

    try {
      const webSocketServer = req.app.get('webSocketServer');
      if (webSocketServer) {
        console.log('📡 [Proposal Accept] Emitting WebSocket events for real-time updates...');
        
        if (clientId) {
          const clientEvent = {
            type: 'proposal:accepted',
            data: {
              conversationId,
              proposalId: actualProposalId,
              boostingId,
              acceptedProposal: response.data.acceptedProposal,
              status: 'accepted',
              acceptedAt: new Date().toISOString(),
              acceptedBy: 'client',
              clientId,
              boosterId
            }
          };
          
          webSocketServer.sendToUser(clientId, clientEvent);
          console.log(`✅ [Proposal Accept] WebSocket event sent to client: ${clientId}`);
        }
        
        if (boosterId) {
          const boosterEvent = {
            type: 'proposal:accepted',
            data: {
              conversationId,
              proposalId: actualProposalId,
              boostingId,
              acceptedProposal: response.data.acceptedProposal,
              status: 'accepted',
              acceptedAt: new Date().toISOString(),
              acceptedBy: 'client',
              clientId,
              boosterId
            }
          };
          
          webSocketServer.sendToUser(boosterId, boosterEvent);
          console.log(`✅ [Proposal Accept] WebSocket event sent to booster: ${boosterId}`);
        }
        
        const conversationUpdateEvent = {
          type: 'conversation:updated',
          data: {
            conversationId,
            status: 'accepted',
            isTemporary: false,
            boostingStatus: 'active',
            updatedAt: new Date().toISOString()
          }
        };
        
        if (clientId) webSocketServer.sendToUser(clientId, conversationUpdateEvent);
        if (boosterId) webSocketServer.sendToUser(boosterId, conversationUpdateEvent);
        
        console.log('✅ [Proposal Accept] All WebSocket events emitted successfully');
      } else {
        console.warn('⚠️ [Proposal Accept] WebSocket server not available for real-time updates');
      }
    } catch (wsError) {
      console.error('❌ [Proposal Accept] Error emitting WebSocket events:', wsError);

    }
    


    try {
      let acceptedConv = null;
      if (conversationId) {
        acceptedConv = await Conversation.findById(conversationId);
      }
      if (!acceptedConv) {
        acceptedConv = await Conversation.findOne({
          isTemporary: true,
          $or: [
            { 'metadata.proposalId': actualProposalId },
            { proposal: actualProposalId }
          ]
        });
      }

      if (acceptedConv) {
        acceptedConv.isTemporary = false;
        acceptedConv.status = 'accepted';
        acceptedConv.expiresAt = null;
        acceptedConv.boostingStatus = 'active';
        await acceptedConv.save();

        const wsServer = req.app.get('webSocketServer');
        if (wsServer) {
          const participants = acceptedConv.participants.map(p => p.toString ? p.toString() : p);
          participants.forEach(pid => {
            wsServer.sendToUser(pid, {
              type: 'conversation:updated',
              data: {
                conversationId: acceptedConv._id,
                status: 'accepted',
                isTemporary: false,
                boostingStatus: 'active',
                updatedAt: new Date().toISOString()
              }
            });
          });
        }
      }
    } catch (cleanupError) {
      console.error('❌ Error updating accepted conversation:', cleanupError);
    }

    return res.json(response.data);
    
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

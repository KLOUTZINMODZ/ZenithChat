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
    const { conversationId, boosterId, clientId, metadata = {} } = req.body;
    let actualProposalId = proposalId;
    let boostingId = metadata?.boostingId;
    let lookupData = null;

    console.log(`🔍 [Proposal Accept] Received request for proposal: ${proposalId}`);
    console.log(`🔍 [Proposal Accept] ConversationId: ${conversationId}`);
    console.log(`🔍 [Proposal Accept] BoosterId: ${boosterId}`);
    console.log(`🔍 [Proposal Accept] ClientId: ${clientId}`);
    console.log(`🔍 [Proposal Accept] Full request body:`, JSON.stringify(req.body, null, 2));
    console.log(`🔍 [Proposal Accept] Metadata:`, metadata);
    console.log(`🔍 [Proposal Accept] Checking boostingId: ${boostingId} (type: ${typeof boostingId})`);
    console.log(`🔍 [Proposal Accept] Metadata boostingId exists: ${!!metadata?.boostingId}`);
    console.log(`🔍 [Proposal Accept] Metadata proposalId: ${metadata?.proposalId}`);
    
    // Se proposalId tem formato "boostingId_boosterId_timestamp", extrai o boostingId
    if (proposalId && typeof proposalId === 'string' && proposalId.includes('_')) {
      const parts = proposalId.split('_');
      if (parts.length === 3) {
        if (!boostingId) {
          boostingId = parts[0];
          console.log(`✅ [Proposal Accept] Extracted boostingId from composite proposalId: ${boostingId}`);
        }
        // O actualProposalId também é só o boostingId (primeira parte)
        actualProposalId = parts[0];
        console.log(`✅ [Proposal Accept] Using boostingId as actualProposalId: ${actualProposalId}`);
      }
    }
    

    if (metadata?.proposalId && typeof metadata.proposalId === 'string' && metadata.proposalId.includes('_')) {
      // Se metadata.proposalId também tem formato composto, extrai o boostingId
      const parts = metadata.proposalId.split('_');
      if (parts.length === 3) {
        actualProposalId = parts[0];
        console.log(`✅ [Proposal Accept] Extracted actualProposalId from composite metadata.proposalId: ${actualProposalId}`);
      }
    } else if (metadata?.proposalId) {
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


    if (boostingId === proposalId && !lookupData?.actualProposalId) {
      console.log(`🔍 [Proposal Accept] ProposalId matches boostingId, need to find actual proposal from conversation`);
      
      try {
        const conversationResponse = await axios.get(`https://zenith.enrelyugi.com.br/api/conversations/${conversationId}`, {
          headers: { Authorization: req.headers.authorization }
        });
        
        const conversationData = conversationResponse.data;
        console.log('🔍 [Proposal Accept] Conversation metadata:', JSON.stringify(conversationData?.metadata, null, 2));
        
        if (conversationData?.metadata?.proposalId) {
          actualProposalId = conversationData.metadata.proposalId;
          console.log('✅ [Proposal Accept] Found actual proposalId from conversation metadata:', actualProposalId);
        }
      } catch (error) {
        console.log('❌ [Proposal Accept] Error fetching conversation metadata:', error.message);
      }
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

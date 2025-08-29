const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');

// Import the boosting controller from HackLoteAPI logic
const axios = require('axios');

// BoostingRequest model schema (simplified for lookup)
const BoostingRequestSchema = new mongoose.Schema({
  proposals: [{
    _id: mongoose.Schema.Types.ObjectId,
    // other proposal fields...
  }]
}, { collection: 'boosting_requests' });

const BoostingRequest = mongoose.model('BoostingRequest', BoostingRequestSchema);

// Base route for proposals
router.get('/', (req, res) => {
  res.json({
    message: 'Proposals API',
    endpoints: {
      accept: 'POST /:proposalId/accept'
    },
    timestamp: new Date().toISOString()
  });
});

// Accept proposal endpoint that forwards to HackLoteAPI (supports both GET and POST)
router.get('/:proposalId/accept', auth, async (req, res) => {
  try {
    const { proposalId } = req.params;
    
    console.log(`🔍 [Proposal Accept GET] Received request for proposal: ${proposalId}`);
    
    // For GET requests, return method not allowed with proper guidance
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
    const { conversationId, boosterId, clientId, metadata } = req.body;
    
    console.log(`🔍 [Proposal Accept] Received request for proposal: ${proposalId}`);
    console.log(`🔍 [Proposal Accept] ConversationId: ${conversationId}`);
    console.log(`🔍 [Proposal Accept] BoosterId: ${boosterId}`);
    console.log(`🔍 [Proposal Accept] ClientId: ${clientId}`);
    console.log(`🔍 [Proposal Accept] Full request body:`, JSON.stringify(req.body, null, 2));
    console.log(`🔍 [Proposal Accept] Metadata:`, JSON.stringify(metadata, null, 2));
    
    // Database lookup to find real boostingId from proposalId
    let boostingId = metadata?.boostingId;
    
    if (!boostingId) {
      console.log(`🔍 [Proposal Accept] No boostingId in metadata, performing database lookup...`);
      
      try {
        const boostingRequest = await BoostingRequest.findOne({
          'proposals._id': new mongoose.Types.ObjectId(proposalId)
        });
        
        if (boostingRequest) {
          boostingId = boostingRequest._id.toString();
          console.log(`✅ [Proposal Accept] Found boostingId via database lookup: ${boostingId}`);
        } else {
          console.log(`❌ [Proposal Accept] No boosting request found for proposalId: ${proposalId}`);
          return res.status(404).json({
            success: false,
            message: 'Proposta não encontrada no sistema',
            error: 'No boosting request found for this proposal'
          });
        }
      } catch (dbError) {
        console.error(`❌ [Proposal Accept] Database lookup error:`, dbError);
        return res.status(500).json({
          success: false,
          message: 'Erro ao buscar dados da proposta',
          error: dbError.message
        });
      }
    }
    
    console.log(`🔍 [Proposal Accept] BoostingId resolved: ${boostingId} (from ${metadata?.boostingId ? 'metadata' : 'database lookup'})`);
    
    // Forward to HackLoteAPI
    const hackLoteApiUrl = process.env.HACKLOTE_API_URL || 'https://zenithapi-steel.vercel.app/api';
    const forwardUrl = `${hackLoteApiUrl}/boosting-requests/${boostingId}/proposals/${proposalId}/accept`;
    
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
    
    console.log(`✅ [Proposal Accept] HackLoteAPI response:`, response.data);
    
    // Return the response from HackLoteAPI
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ [Proposal Accept] Error:', error.message);
    
    if (error.response) {
      console.error('❌ [Proposal Accept] API Error Response:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor ao aceitar proposta',
      error: error.message
    });
  }
});

module.exports = router;

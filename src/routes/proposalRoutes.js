const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// Import the boosting controller from HackLoteAPI logic
const axios = require('axios');

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
    
    // Check if metadata has boostingId
    let boostingId = metadata?.boostingId;
    
    console.log(`🔍 [Proposal Accept] Checking boostingId: ${boostingId} (type: ${typeof boostingId})`);
    console.log(`🔍 [Proposal Accept] Metadata boostingId exists: ${!!metadata?.boostingId}`);
    
    if (!boostingId) {
      console.log(`⚠️ [Proposal Accept] No boostingId in metadata, attempting database lookup for proposalId: ${proposalId}`);
      
      try {
        // Try to find the proposal in HackLoteAPI to get the correct boostingId
        const proposalLookupUrl = `${process.env.HACKLOTE_API_URL || 'https://zenithapi-steel.vercel.app/api'}/proposals/${proposalId}/boosting-id`;
        console.log(`🔍 [Proposal Accept] Looking up boostingId at: ${proposalLookupUrl}`);
        
        const lookupResponse = await axios.get(proposalLookupUrl, {
          headers: {
            'Authorization': req.headers.authorization,
            'Content-Type': 'application/json'
          }
        });
        
        if (lookupResponse.data && lookupResponse.data.boostingId) {
          boostingId = lookupResponse.data.boostingId;
          console.log(`✅ [Proposal Accept] Found boostingId from lookup: ${boostingId}`);
        } else {
          throw new Error('BoostingId not found in lookup response');
        }
        
      } catch (lookupError) {
        console.error(`❌ [Proposal Accept] Lookup failed:`, lookupError.message);
        console.error(`❌ [Proposal Accept] Lookup error details:`, lookupError.response?.data || lookupError);
        
        return res.status(500).json({
          success: false,
          message: 'Não foi possível encontrar o boostingId para esta proposta',
          error: `Lookup failed: ${lookupError.message}`,
          details: {
            proposalId: proposalId,
            lookupUrl: `${process.env.HACKLOTE_API_URL || 'https://zenithapi-steel.vercel.app/api'}/proposals/${proposalId}/boosting-id`,
            originalError: lookupError.response?.data || lookupError.message
          }
        });
      }
    }
    
    console.log(`🔍 [Proposal Accept] Final BoostingId: ${boostingId}`);
    
    // Validate boostingId before forwarding
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

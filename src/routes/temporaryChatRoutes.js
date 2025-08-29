const express = require('express');
const router = express.Router();
const temporaryChatController = require('../controllers/temporaryChatController');
const authMiddleware = require('../middleware/auth');


router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Temporary chat routes are working',
    timestamp: new Date().toISOString()
  });
});


router.post('/create-temporary-chat', authMiddleware, temporaryChatController.createTemporaryChat);


router.post('/conversation/:conversationId/accept-proposal', authMiddleware, temporaryChatController.acceptTemporaryProposal);


router.get('/expired-chats', authMiddleware, temporaryChatController.getExpiredTemporaryChats);


router.post('/cleanup-expired', authMiddleware, temporaryChatController.cleanupExpiredChats);

module.exports = router;

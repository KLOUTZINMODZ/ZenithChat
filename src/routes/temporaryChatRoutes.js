const express = require('express');
const router = express.Router();
const temporaryChatController = require('../controllers/temporaryChatController');
const authMiddleware = require('../middleware/auth');

// Endpoint de teste (sem auth para debug)
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Temporary chat routes are working',
    timestamp: new Date().toISOString()
  });
});

// Criar chat temporário (chamado quando proposta é enviada)
router.post('/create-temporary-chat', authMiddleware, temporaryChatController.createTemporaryChat);

// Aceitar proposta e converter chat temporário em permanente
router.post('/conversation/:conversationId/accept-proposal', authMiddleware, temporaryChatController.acceptTemporaryProposal);

// Listar chats temporários expirados (para administração)
router.get('/expired-chats', authMiddleware, temporaryChatController.getExpiredTemporaryChats);

// Limpar chats temporários expirados
router.post('/cleanup-expired', authMiddleware, temporaryChatController.cleanupExpiredChats);

module.exports = router;

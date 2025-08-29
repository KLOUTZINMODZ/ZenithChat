const express = require('express');
const router = express.Router();
const agreementController = require('../controllers/agreementController');
const authMiddleware = require('../middleware/auth');

// Aplicar autenticação a todas as rotas
router.use(authMiddleware);

// Rotas por agreement_id (novo padrão)
router.post('/create', agreementController.createAgreement);
router.get('/:agreementId', agreementController.getAgreement);
router.post('/:agreementId/complete', agreementController.completeAgreement);
router.post('/:agreementId/cancel', agreementController.cancelAgreement);
router.post('/:agreementId/renegotiate', agreementController.renegotiateAgreement);

// Rotas de listagem
router.get('/conversation/:conversationId', agreementController.getConversationAgreements);
router.get('/user/me', agreementController.getUserAgreements);

module.exports = router;

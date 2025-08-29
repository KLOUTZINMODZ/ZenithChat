const express = require('express');
const BoostingChatController = require('../controllers/boostingChatController');
const conversationController = require('../controllers/conversationController');
const auth = require('../middleware/auth');
const checkChatStatus = require('../middleware/checkChatStatus');
const AgreementMigrationMiddleware = require('../middleware/agreementMigrationMiddleware');

const router = express.Router();
const controller = new BoostingChatController();

// Middleware de autenticação para todas as rotas
// router.use(auth);

// Rotas para controles de boosting (com migração automática)
router.get('/conversation/:conversationId/proposal', auth, AgreementMigrationMiddleware.autoMigrate(), controller.getAcceptedProposal);
router.post('/conversation/:conversationId/renegotiate', auth, checkChatStatus, AgreementMigrationMiddleware.dualCompatibility(), controller.renegotiateProposal);
router.post('/conversation/:conversationId/cancel', auth, AgreementMigrationMiddleware.dualCompatibility(), controller.cancelService);
router.post('/conversation/:conversationId/confirm-delivery', auth, AgreementMigrationMiddleware.dualCompatibility(), controller.confirmDelivery);
router.post('/conversation/:conversationId/report', auth, AgreementMigrationMiddleware.autoMigrate(), controller.reportService);
router.post('/conversation/:conversationId/unreport', auth, AgreementMigrationMiddleware.autoMigrate(), controller.unreportConversation);
router.get('/conversation/:conversationId/status', auth, AgreementMigrationMiddleware.autoMigrate(), controller.getConversationStatus);

// Nova rota para salvar proposta aceita
router.post('/proposal/save', auth, controller.saveAcceptedProposal);

// Rota para desbloquear conversa (nova proposta aceita)
router.post('/conversation/:conversationId/unblock', auth, conversationController.unblockConversation);

module.exports = router;

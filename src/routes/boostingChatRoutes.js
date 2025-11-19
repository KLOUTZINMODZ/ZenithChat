const express = require('express');
const BoostingChatController = require('../controllers/boostingChatController');
const conversationController = require('../controllers/conversationController');
const { auth } = require('../middleware/auth');
const checkChatStatus = require('../middleware/checkChatStatus');
const AgreementMigrationMiddleware = require('../middleware/agreementMigrationMiddleware');

const router = express.Router();
const controller = new BoostingChatController();

// OPTIONS handler para CORS preflight
router.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  res.status(204).end();
});


// Rotas de proposta/conversação
router.get('/conversation/:conversationId/proposal', auth, AgreementMigrationMiddleware.autoMigrate(), controller.getAcceptedProposal);
router.get('/conversations/:conversationId', auth, AgreementMigrationMiddleware.autoMigrate(), controller.getConversation);
router.post('/conversation/:conversationId/renegotiate', auth, checkChatStatus, AgreementMigrationMiddleware.dualCompatibility(), controller.renegotiateProposal);
router.post('/conversation/:conversationId/cancel', auth, AgreementMigrationMiddleware.dualCompatibility(), controller.cancelService);
router.post('/conversation/:conversationId/confirm-delivery', auth, AgreementMigrationMiddleware.dualCompatibility(), controller.confirmDelivery);
router.post('/conversation/:conversationId/report', auth, AgreementMigrationMiddleware.autoMigrate(), controller.reportService);
router.post('/conversation/:conversationId/unreport', auth, AgreementMigrationMiddleware.autoMigrate(), controller.unreportConversation);
router.get('/conversation/:conversationId/status', auth, AgreementMigrationMiddleware.autoMigrate(), controller.getConversationStatus);


router.post('/proposal/save', auth, controller.saveAcceptedProposal);


router.post('/conversation/:conversationId/unblock', auth, conversationController.unblockConversation);

module.exports = router;

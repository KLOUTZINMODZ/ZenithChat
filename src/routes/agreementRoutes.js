const express = require('express');
const router = express.Router();
const agreementController = require('../controllers/agreementController');
const { auth: authMiddleware } = require('../middleware/auth');


router.use(authMiddleware);


router.post('/create', agreementController.createAgreement);
router.get('/:agreementId', agreementController.getAgreement);
router.post('/:agreementId/complete', agreementController.completeAgreement);
router.post('/:agreementId/cancel', agreementController.cancelAgreement);
router.post('/:agreementId/renegotiate', agreementController.renegotiateAgreement);


router.get('/conversation/:conversationId', agreementController.getConversationAgreements);
router.get('/user/me', agreementController.getUserAgreements);

module.exports = router;

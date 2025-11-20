const express = require('express');
const router = express.Router();
const boostingOrderController = require('../controllers/boostingOrderController');
const { auth } = require('../middleware/auth');

/**
 * Rotas para BoostingOrders
 * Endpoints para consultar pedidos de boosting persistentes
 */

// Aplicar autenticação em todas as rotas
router.use(auth);

// Listar boosting orders do usuário
router.get('/', boostingOrderController.listBoostingOrders);

// Buscar boosting order por ID
router.get('/:orderId', boostingOrderController.getBoostingOrder);

// Buscar boosting order por conversationId
router.get('/conversation/:conversationId', boostingOrderController.getBoostingOrderByConversation);

module.exports = router;

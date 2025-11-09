const express = require('express');
const router = express.Router();
const boostingOrderController = require('../controllers/boostingOrderController');
const auth = require('../middleware/auth');

/**
 * Rotas para BoostingOrders
 * Endpoints para consultar pedidos de boosting persistentes
 */

// Buscar boosting order por ID
router.get('/:orderId', auth, boostingOrderController.getBoostingOrder);

// Listar boosting orders do usuário
router.get('/', auth, boostingOrderController.listBoostingOrders);

module.exports = router;

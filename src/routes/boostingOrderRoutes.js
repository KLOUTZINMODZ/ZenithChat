const express = require('express');
const router = express.Router();
const boostingOrderController = require('../controllers/boostingOrderController');
const auth = require('../middleware/auth');

/**
 * Rotas para BoostingOrders
 * Endpoints para consultar pedidos de boosting persistentes
 */

// Listar boosting orders do usuário
router.get('/', auth, (req, res) => boostingOrderController.listBoostingOrders(req, res));

// Buscar boosting order por ID (deve vir depois para não capturar '/')
router.get('/:orderId', auth, (req, res) => boostingOrderController.getBoostingOrder(req, res));

module.exports = router;

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const favoritesController = require('../controllers/favoritesController');
const logger = require('../utils/logger');

// Middleware de log para todas as rotas deste router
router.use((req, res, next) => {
  logger.error(`DEBUG FAVORITES: ${req.method} ${req.originalUrl}`);
  logger.error(`DEBUG FAVORITES BODY: ${JSON.stringify(req.body)}`);
  next();
});

/**
 * @route   GET /api/favorites
 * @desc    Obtém todos os favoritos do usuário
 * @access  Private
 */
router.get('/', auth, favoritesController.getFavorites);

/**
 * @route   POST /api/favorites
 * @desc    Adiciona um item aos favoritos
 * @access  Private
 */
router.post('/', auth, favoritesController.addFavorite);

/**
 * @route   DELETE /api/favorites/:itemId
 * @desc    Remove um item dos favoritos
 * @access  Private
 */
router.delete('/:itemId', auth, favoritesController.removeFavorite);

/**
 * @route   DELETE /api/favorites
 * @desc    Remove todos os favoritos
 * @access  Private
 */
router.delete('/', auth, favoritesController.clearFavorites);

module.exports = router;

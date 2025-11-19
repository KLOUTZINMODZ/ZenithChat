const express = require('express');
const router = express.Router();
const achievementController = require('../controllers/achievementController');
const { auth } = require('../middleware/auth');

// Todas as rotas requerem autenticação
router.use(auth);

/**
 * @route   GET /api/achievements
 * @desc    Obtém todas as conquistas do usuário
 * @access  Private
 */
router.get('/', achievementController.getUserAchievements);

/**
 * @route   POST /api/achievements/update-stats
 * @desc    Atualiza estatísticas e verifica conquistas
 * @access  Private
 */
router.post('/update-stats', achievementController.updateStats);

/**
 * @route   POST /api/achievements/check
 * @desc    Força verificação de conquistas
 * @access  Private
 */
router.post('/check', achievementController.forceCheck);

/**
 * @route   GET /api/achievements/unnotified
 * @desc    Obtém conquistas não notificadas
 * @access  Private
 */
router.get('/unnotified', achievementController.getUnnotified);

/**
 * @route   GET /api/achievements/user/:userId
 * @desc    Obtém conquistas de um usuário específico
 * @access  Private
 */
router.get('/user/:userId', achievementController.getUserAchievementsById);

/**
 * @route   PUT /api/achievements/:achievementId/notified
 * @desc    Marca conquista como notificada
 * @access  Private
 */
router.put('/:achievementId/notified', achievementController.markAsNotified);

module.exports = router;

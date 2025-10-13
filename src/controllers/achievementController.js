const User = require('../models/User');
const achievementService = require('../services/achievementService');

/**
 * Obtém todas as conquistas de um usuário
 * GET /api/achievements
 */
exports.getUserAchievements = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const achievements = achievementService.getUserAchievements(user);

    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    console.error('Error getting user achievements:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar conquistas',
      error: error.message
    });
  }
};

/**
 * Atualiza estatísticas e verifica conquistas
 * POST /api/achievements/update-stats
 */
exports.updateStats = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const {
      totalSales,
      totalPurchases,
      averageRating,
      ratingCount,
      currentBalance
    } = req.body;

    // Preparar stats para atualização
    const stats = {
      totalSales: totalSales !== undefined ? totalSales : user.achievements?.stats?.totalSales || 0,
      totalPurchases: totalPurchases !== undefined ? totalPurchases : user.achievements?.stats?.totalPurchases || 0,
      totalTransactions: (totalSales || 0) + (totalPurchases || 0),
      averageRating: averageRating !== undefined ? averageRating : user.achievements?.stats?.averageRating || 0,
      ratingCount: ratingCount !== undefined ? ratingCount : user.achievements?.stats?.ratingCount || 0,
      currentBalance: currentBalance !== undefined ? currentBalance : user.walletBalance || 0,
      joinDate: user.createdAt
    };

    // Processar conquistas
    const result = await achievementService.processAchievements(user, stats);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao processar conquistas',
        error: result.error
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Estatísticas atualizadas com sucesso',
      data: {
        newAchievements: result.newAchievements,
        totalUnlocked: result.totalUnlocked,
        stats: user.achievements.stats
      }
    });
  } catch (error) {
    console.error('Error updating stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao atualizar estatísticas',
      error: error.message
    });
  }
};

/**
 * Força verificação de conquistas
 * POST /api/achievements/check
 */
exports.forceCheck = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const result = await achievementService.forceCheckAchievements(user);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao verificar conquistas',
        error: result.error
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Conquistas verificadas com sucesso',
      data: {
        newAchievements: result.newAchievements,
        totalUnlocked: result.totalUnlocked
      }
    });
  } catch (error) {
    console.error('Error force checking achievements:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar conquistas',
      error: error.message
    });
  }
};

/**
 * Marca conquista como notificada
 * PUT /api/achievements/:achievementId/notified
 */
exports.markAsNotified = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { achievementId } = req.params;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // Encontrar e marcar conquista como notificada
    const achievement = user.achievements?.unlocked?.find(
      a => a.achievementId === achievementId
    );

    if (!achievement) {
      return res.status(404).json({
        success: false,
        message: 'Conquista não encontrada'
      });
    }

    achievement.notified = true;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Conquista marcada como notificada'
    });
  } catch (error) {
    console.error('Error marking achievement as notified:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao marcar conquista',
      error: error.message
    });
  }
};

/**
 * Obtém conquistas não notificadas
 * GET /api/achievements/unnotified
 */
exports.getUnnotified = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const unnotified = user.achievements?.unlocked?.filter(
      a => !a.notified
    ) || [];

    return res.status(200).json({
      success: true,
      data: unnotified
    });
  } catch (error) {
    console.error('Error getting unnotified achievements:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar conquistas não notificadas',
      error: error.message
    });
  }
};

/**
 * Obtém conquistas de um usuário específico por ID
 * GET /api/achievements/user/:userId
 */
exports.getUserAchievementsById = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'ID do usuário é obrigatório'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const achievements = achievementService.getUserAchievements(user);

    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    console.error('Error getting user achievements by id:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar conquistas do usuário',
      error: error.message
    });
  }
};

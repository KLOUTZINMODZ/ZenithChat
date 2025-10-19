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
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
      });
    }

    const achievements = achievementService.getUserAchievements(user);

    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar conquistas',
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
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
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
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao atualizar estatísticas',
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
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
      });
    }

    const result = await achievementService.forceCheckAchievements(user);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao verificar conquistas',
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
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar conquistas',
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
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
      });
    }

    // Encontrar e marcar conquista como notificada
    const achievement = user.achievements?.unlocked?.find(
      a => a.achievementId === achievementId
    );

    if (!achievement) {
      return res.status(404).json({
        success: false,
      });
    }

    achievement.notified = true;
    await user.save();

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao marcar conquista',
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
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
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
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar conquistas não notificadas',
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
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
      });
    }

    // Buscar dados reais do usuário para calcular conquistas
    const Purchase = require('../models/Purchase');
    const Review = require('../models/Review');

    try {
      // Contar vendas completadas
      const totalSales = await Purchase.countDocuments({
        sellerId: userId,
      });

      // Contar compras completadas
      const totalPurchases = await Purchase.countDocuments({
        buyerId: userId,
      });

      // Buscar rating médio (reviews recebidas)
      const reviews = await Review.aggregate([
        { $match: { targetUserId: userId } },
        { $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          count: { $sum: 1 }
        }}
      ]);

      const averageRating = reviews.length > 0 ? reviews[0].averageRating : 0;
      const ratingCount = reviews.length > 0 ? reviews[0].count : 0;

      

      // Processar conquistas com os dados reais
      const stats = {
        totalSales,
        totalPurchases,
        totalTransactions: totalSales + totalPurchases,
        averageRating,
        ratingCount,
        currentBalance: user.walletBalance || 0,
        joinDate: user.createdAt
      };

      // Processar conquistas automaticamente
      await achievementService.processAchievements(user, stats);

    } catch (calcError) {
      
      // Continuar com dados salvos se o cálculo falhar
    }

    // Retornar conquistas (agora atualizadas)
    const achievements = achievementService.getUserAchievements(user);

    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar conquistas do usuário',
    });
  }
};

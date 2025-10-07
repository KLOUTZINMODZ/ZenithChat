/**
 * Achievement Service
 * Gerencia lógica de desbloqueio de conquistas
 */

// Definição de todas as conquistas (sincronizado com frontend)
const ACHIEVEMENTS = {
  // VENDAS
  first_sale: { id: 'first_sale', type: 'sales', value: 1 },
  seller_5: { id: 'seller_5', type: 'sales', value: 5 },
  seller_10: { id: 'seller_10', type: 'sales', value: 10 },
  seller_25: { id: 'seller_25', type: 'sales', value: 25 },
  seller_50: { id: 'seller_50', type: 'sales', value: 50 },
  seller_100: { id: 'seller_100', type: 'sales', value: 100 },

  // COMPRAS
  first_purchase: { id: 'first_purchase', type: 'purchases', value: 1 },
  buyer_5: { id: 'buyer_5', type: 'purchases', value: 5 },
  buyer_10: { id: 'buyer_10', type: 'purchases', value: 10 },
  buyer_25: { id: 'buyer_25', type: 'purchases', value: 25 },
  buyer_50: { id: 'buyer_50', type: 'purchases', value: 50 },
  buyer_100: { id: 'buyer_100', type: 'purchases', value: 100 },

  // AVALIAÇÃO
  rating_3: { id: 'rating_3', type: 'rating', value: 3.0 },
  rating_4: { id: 'rating_4', type: 'rating', value: 4.0 },
  rating_4_5: { id: 'rating_4_5', type: 'rating', value: 4.5 },
  rating_5: { id: 'rating_5', type: 'rating', value: 5.0 },

  // FINANCEIRO
  balance_100: { id: 'balance_100', type: 'balance', value: 100 },
  balance_500: { id: 'balance_500', type: 'balance', value: 500 },
  balance_1000: { id: 'balance_1000', type: 'balance', value: 1000 },
  balance_5000: { id: 'balance_5000', type: 'balance', value: 5000 },

  // ESPECIAL
  first_week: { id: 'first_week', type: 'combined', condition: 'joinDate_7days' },
  jack_of_trades: { id: 'jack_of_trades', type: 'combined', condition: 'sales_5_purchases_5' },
  balanced_trader: { id: 'balanced_trader', type: 'combined', condition: 'sales_10_purchases_10' },
  perfect_start: { id: 'perfect_start', type: 'combined', condition: 'perfect_rating_10_transactions' }
};

/**
 * Verifica quais conquistas devem ser desbloqueadas
 */
function checkAchievements(user, stats) {
  const newAchievements = [];
  const {
    totalSales = 0,
    totalPurchases = 0,
    averageRating = 0,
    currentBalance = 0,
    joinDate = user.createdAt
  } = stats;

  const totalTransactions = totalSales + totalPurchases;
  const now = new Date();
  const joinDateObj = new Date(joinDate);
  const daysSinceJoin = Math.floor((now - joinDateObj) / (1000 * 60 * 60 * 24));

  // Verificar cada conquista
  for (const achievement of Object.values(ACHIEVEMENTS)) {
    // Pular se já foi desbloqueada
    if (user.hasAchievement(achievement.id)) {
      continue;
    }

    let shouldUnlock = false;

    switch (achievement.type) {
      case 'sales':
        shouldUnlock = totalSales >= achievement.value;
        break;

      case 'purchases':
        shouldUnlock = totalPurchases >= achievement.value;
        break;

      case 'rating':
        shouldUnlock = averageRating >= achievement.value;
        break;

      case 'balance':
        shouldUnlock = currentBalance >= achievement.value;
        break;

      case 'combined':
        shouldUnlock = checkCombinedCondition(
          achievement.condition,
          { totalSales, totalPurchases, averageRating, totalTransactions, daysSinceJoin }
        );
        break;
    }

    if (shouldUnlock) {
      newAchievements.push(achievement.id);
    }
  }

  return newAchievements;
}

/**
 * Verifica condições combinadas especiais
 */
function checkCombinedCondition(condition, stats) {
  const { totalSales, totalPurchases, averageRating, totalTransactions, daysSinceJoin } = stats;

  switch (condition) {
    case 'joinDate_7days':
      return daysSinceJoin >= 7;

    case 'sales_5_purchases_5':
      return totalSales >= 5 && totalPurchases >= 5;

    case 'sales_10_purchases_10':
      return totalSales >= 10 && totalPurchases >= 10;

    case 'perfect_rating_10_transactions':
      return averageRating >= 5.0 && totalTransactions >= 10;

    default:
      return false;
  }
}

/**
 * Processa e desbloqueia conquistas para um usuário
 */
async function processAchievements(user, stats) {
  try {
    // Atualizar estatísticas do usuário
    user.updateAchievementStats(stats);

    // Verificar conquistas a desbloquear
    const achievementsToUnlock = checkAchievements(user, stats);

    // Desbloquear conquistas
    const unlockedAchievements = [];
    for (const achievementId of achievementsToUnlock) {
      const result = user.unlockAchievement(achievementId);
      if (!result.alreadyUnlocked) {
        unlockedAchievements.push(achievementId);
      }
    }

    // Salvar usuário
    await user.save();

    return {
      success: true,
      newAchievements: unlockedAchievements,
      totalUnlocked: user.achievements?.unlocked?.length || 0
    };
  } catch (error) {
    console.error('Error processing achievements:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Obtém todas as conquistas de um usuário
 */
function getUserAchievements(user) {
  if (!user.achievements) {
    return {
      unlocked: [],
      stats: {
        totalSales: 0,
        totalPurchases: 0,
        totalTransactions: 0,
        averageRating: 0,
        ratingCount: 0,
        highestBalance: 0,
        lastUpdated: new Date()
      }
    };
  }

  return {
    unlocked: user.achievements.unlocked || [],
    stats: user.achievements.stats || {
      totalSales: 0,
      totalPurchases: 0,
      totalTransactions: 0,
      averageRating: 0,
      ratingCount: 0,
      highestBalance: 0,
      lastUpdated: new Date()
    }
  };
}

/**
 * Força verificação de conquistas para um usuário
 */
async function forceCheckAchievements(user) {
  try {
    // Usar stats já salvos ou valores padrão
    const stats = {
      totalSales: user.achievements?.stats?.totalSales || 0,
      totalPurchases: user.achievements?.stats?.totalPurchases || 0,
      averageRating: user.achievements?.stats?.averageRating || 0,
      currentBalance: user.walletBalance || 0,
      joinDate: user.createdAt
    };

    return await processAchievements(user, stats);
  } catch (error) {
    console.error('Error force checking achievements:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  ACHIEVEMENTS,
  checkAchievements,
  processAchievements,
  getUserAchievements,
  forceCheckAchievements
};

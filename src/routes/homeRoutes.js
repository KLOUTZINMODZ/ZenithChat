const express = require('express');
const router = express.Router();
const MarketItem = require('../models/MarketItem');
const BoostingRequest = require('../models/BoostingRequest');
const Review = require('../models/Review');
const User = require('../models/User');

// GET /api/home/featured-items - Buscar itens em destaque do marketplace
router.get('/featured-items', async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 12));
    const filter = req.query.filter || 'newest'; // newest, popular, price_low, price_high

    let sort = { createdAt: -1 }; // Default: mais novos
    
    switch (filter) {
      case 'popular':
        sort = { views: -1, createdAt: -1 };
        break;
      case 'price_low':
        sort = { price: 1 };
        break;
      case 'price_high':
        sort = { price: -1 };
        break;
    }

    const items = await MarketItem.find({ 
      status: 'active',
      stock: { $gt: 0 }
    })
      .sort(sort)
      .limit(limit)
      .select('_id title description price images game category stock createdAt views')
      .populate('sellerId', 'name username avatar')
      .lean();

    const formatted = items.map(item => ({
      _id: item._id,
      title: item.title,
      description: item.description,
      price: item.price,
      image: Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null,
      game: item.game || 'Outros',
      category: item.category,
      stock: item.stock,
      seller: {
        name: item.sellerId?.name || item.sellerId?.username || 'Vendedor',
        avatar: item.sellerId?.avatar
      },
      isNew: (Date.now() - new Date(item.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000, // Menos de 7 dias
      views: item.views || 0
    }));

    return res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('[HOME] Error fetching featured items:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar itens em destaque', error: error.message });
  }
});

// GET /api/home/featured-boostings - Buscar pedidos de boosting em destaque
router.get('/featured-boostings', async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));

    const boostings = await BoostingRequest.find({
      status: { $in: ['open', 'pending'] }
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('_id game title currentRank desiredRank price estimatedTime description status createdAt')
      .populate('userId', 'name username avatar')
      .lean();

    const formatted = boostings.map(boost => ({
      _id: boost._id,
      game: boost.game,
      title: boost.title || `Boosting ${boost.game}`,
      currentRank: boost.currentRank,
      desiredRank: boost.desiredRank,
      price: boost.price,
      estimatedTime: boost.estimatedTime,
      description: boost.description,
      status: boost.status,
      client: {
        name: boost.userId?.name || boost.userId?.username || 'Cliente',
        avatar: boost.userId?.avatar
      },
      isNew: (Date.now() - new Date(boost.createdAt).getTime()) < 3 * 24 * 60 * 60 * 1000 // Menos de 3 dias
    }));

    return res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('[HOME] Error fetching featured boostings:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar boostings em destaque', error: error.message });
  }
});

// GET /api/home/testimonials - Buscar avaliações em destaque
router.get('/testimonials', async (req, res) => {
  try {
    const limit = Math.min(10, Math.max(1, parseInt(req.query.limit) || 6));

    // Buscar reviews com rating >= 4 e que tenham comentário
    const reviews = await Review.find({
      status: 'approved',
      rating: { $gte: 4 },
      comment: { $ne: null, $ne: '' }
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('rating title comment createdAt')
      .populate('userId', 'name username avatar')
      .populate('targetId', 'name username')
      .lean();

    const formatted = reviews.map(review => ({
      _id: review._id,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      reviewer: {
        name: review.userId?.name || review.userId?.username || 'Usuário',
        avatar: review.userId?.avatar
      },
      reviewedUser: review.targetId?.name || review.targetId?.username,
      createdAt: review.createdAt
    }));

    return res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('[HOME] Error fetching testimonials:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar avaliações', error: error.message });
  }
});

// GET /api/home/stats - Buscar estatísticas da plataforma
router.get('/stats', async (req, res) => {
  try {
    const [totalItems, totalBoostings, totalUsers, totalReviews] = await Promise.all([
      MarketItem.countDocuments({ status: 'active' }),
      BoostingRequest.countDocuments({ status: { $in: ['open', 'pending', 'in_progress'] } }),
      User.countDocuments({ isBanned: { $ne: true } }),
      Review.countDocuments({ status: 'approved' })
    ]);

    return res.json({
      success: true,
      data: {
        totalItems,
        totalBoostings,
        totalUsers,
        totalReviews,
        averageRating: 4.8 // Pode calcular dinamicamente se quiser
      }
    });
  } catch (error) {
    console.error('[HOME] Error fetching stats:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas', error: error.message });
  }
});

module.exports = router;

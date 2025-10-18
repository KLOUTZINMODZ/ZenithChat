const express = require('express');
const router = express.Router();
const MarketItem = require('../models/MarketItem');
const BoostingRequest = require('../models/BoostingRequest');
const Review = require('../models/Review');
const User = require('../models/User');

// GET /api/home/marketplace - Buscar ofertas em destaque do marketplace
router.get('/marketplace', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 12;
    const filter = req.query.filter || 'popular'; // 'popular', 'recent', 'price'
    
    let sortCriteria = {};
    
    switch (filter) {
      case 'recent':
        sortCriteria = { createdAt: -1 };
        break;
      case 'price':
        sortCriteria = { price: 1 };
        break;
      case 'popular':
      default:
        sortCriteria = { views: -1, createdAt: -1 };
        break;
    }
    
    const items = await MarketItem.find({ 
      status: 'active',
      stock: { $gt: 0 }
    })
      .sort(sortCriteria)
      .limit(limit)
      .populate('seller', 'name username avatar profileImage')
      .lean();
    
    const formattedItems = items.map(item => ({
      _id: item._id,
      title: item.title,
      game: item.game,
      category: item.category,
      price: item.price,
      image: item.image || (item.images && item.images[0]) || '',
      seller: {
        _id: item.seller?._id,
        name: item.seller?.name || item.seller?.username || 'Vendedor',
        avatar: item.seller?.avatar || item.seller?.profileImage
      },
      isPopular: item.views > 50,
      isNew: (Date.now() - new Date(item.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000 // Novo se < 7 dias
    }));
    
    return res.json({
      success: true,
      data: formattedItems,
      total: formattedItems.length
    });
  } catch (error) {
    console.error('[HOME MARKETPLACE ERROR]', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar ofertas do marketplace',
      error: error.message
    });
  }
});

// GET /api/home/boostings - Buscar pedidos de boosting em destaque
router.get('/boostings', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 12;
    
    const boostings = await BoostingRequest.find({
      status: 'open'
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'name username avatar profileImage')
      .lean();
    
    const formattedBoostings = boostings.map(boost => ({
      _id: boost._id,
      game: boost.game,
      title: boost.title || `Boosting ${boost.game}`,
      currentRank: boost.currentRank,
      desiredRank: boost.desiredRank,
      price: boost.price,
      estimatedTime: boost.estimatedTime || 'A combinar',
      user: {
        _id: boost.userId?._id,
        name: boost.userId?.name || boost.userId?.username || 'Cliente',
        avatar: boost.userId?.avatar || boost.userId?.profileImage
      },
      isUrgent: boost.priority === 'high',
      createdAt: boost.createdAt
    }));
    
    return res.json({
      success: true,
      data: formattedBoostings,
      total: formattedBoostings.length
    });
  } catch (error) {
    console.error('[HOME BOOSTINGS ERROR]', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar pedidos de boosting',
      error: error.message
    });
  }
});

// GET /api/home/reviews - Buscar avaliações em destaque
router.get('/reviews', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    
    const reviews = await Review.find({
      status: 'approved',
      rating: { $gte: 4 }, // Apenas 4 e 5 estrelas
      comment: { $ne: null, $ne: '' } // Apenas com comentário
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'name username avatar profileImage')
      .populate('targetId', 'name username')
      .lean();
    
    const formattedReviews = reviews.map(review => ({
      _id: review._id,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      user: {
        name: review.userId?.name || review.userId?.username || 'Usuário',
        avatar: review.userId?.avatar || review.userId?.profileImage
      },
      target: {
        name: review.targetId?.name || review.targetId?.username || 'Vendedor'
      },
      createdAt: review.createdAt,
      isVerified: review.isVerifiedPurchase
    }));
    
    return res.json({
      success: true,
      data: formattedReviews,
      total: formattedReviews.length
    });
  } catch (error) {
    console.error('[HOME REVIEWS ERROR]', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar avaliações',
      error: error.message
    });
  }
});

// GET /api/home/stats - Estatísticas gerais da plataforma
router.get('/stats', async (req, res) => {
  try {
    const [userCount, itemCount, reviewCount] = await Promise.all([
      User.countDocuments({ status: { $ne: 'banned' } }),
      MarketItem.countDocuments({ status: 'active' }),
      Review.countDocuments({ status: 'approved' })
    ]);
    
    return res.json({
      success: true,
      data: {
        users: userCount,
        items: itemCount,
        reviews: reviewCount,
        transactions: '1M+', // Placeholder - pode ser calculado de Purchase
        security: '100%',
        speed: '< 1s'
      }
    });
  } catch (error) {
    console.error('[HOME STATS ERROR]', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar estatísticas',
      error: error.message
    });
  }
});

module.exports = router;

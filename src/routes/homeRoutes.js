const express = require('express');
const router = express.Router();
const { auth, optionalAuth } = require('../middleware/auth');
const MarketItem = require('../models/MarketItem');
const BoostingRequest = require('../models/BoostingRequest');
const Review = require('../models/Review');
const User = require('../models/User');

// GET /api/home/data - Dados da homepage (público com limitações)
router.get('/data', optionalAuth, async (req, res) => {
  try {
    const userId = req.user?._id;
    const userStatus = req.user?.status;
    
    // Verificar se usuário está banido
    const isBanned = userStatus === 'banned' || userStatus === 'suspended';
    
    // Limitar acesso para usuários não logados ou banidos
    const canAccessDynamic = !!userId && !isBanned;
    
    // Buscar items do marketplace (últimos 12, ativos)
    const marketplaceItems = await MarketItem.find({ 
      status: 'active',
      stock: { $gt: 0 }
    })
      .sort({ createdAt: -1 })
      .limit(12)
      .select('title price images game description featured')
      .populate('sellerId', 'name username avatar')
      .lean();
    
    // Buscar pedidos de boosting (últimos 8, abertos)
    const boostingRequests = await BoostingRequest.find({ 
      status: 'open'
    })
      .sort({ createdAt: -1 })
      .limit(8)
      .select('game title currentRank desiredRank price description')
      .populate('userId', 'name username avatar')
      .lean();
    
    // Buscar avaliações recentes (top 6 avaliações 4-5 estrelas)
    const reviews = await Review.find({ 
      status: 'approved',
      rating: { $gte: 4 }
    })
      .sort({ createdAt: -1 })
      .limit(6)
      .select('rating title comment createdAt')
      .populate('userId', 'name username avatar')
      .populate('targetId', 'name username')
      .lean();
    
    // Estatísticas da plataforma
    const stats = {
      totalUsers: await User.countDocuments({ status: { $ne: 'banned' } }),
      totalMarketItems: await MarketItem.countDocuments({ status: 'active' }),
      totalBoostings: await BoostingRequest.countDocuments(),
      totalReviews: await Review.countDocuments({ status: 'approved' })
    };
    
    // Formatar response
    const response = {
      success: true,
      data: {
        canAccessDynamic, // Se pode ver conteúdo dinâmico
        isBanned,
        marketplace: canAccessDynamic ? marketplaceItems.map(item => ({
          _id: item._id,
          title: item.title,
          price: item.price,
          image: Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null,
          game: item.game,
          description: item.description,
          featured: item.featured || false,
          seller: {
            _id: item.sellerId?._id,
            name: item.sellerId?.name || item.sellerId?.username || 'Vendedor',
            avatar: item.sellerId?.avatar
          }
        })) : [],
        boosting: canAccessDynamic ? boostingRequests.map(req => ({
          _id: req._id,
          game: req.game,
          title: req.title || `${req.game} - Boost`,
          currentRank: req.currentRank,
          desiredRank: req.desiredRank,
          price: req.price,
          description: req.description,
          client: {
            _id: req.userId?._id,
            name: req.userId?.name || req.userId?.username || 'Cliente',
            avatar: req.userId?.avatar
          }
        })) : [],
        reviews: reviews.map(review => ({
          _id: review._id,
          rating: review.rating,
          title: review.title,
          comment: review.comment,
          createdAt: review.createdAt,
          reviewer: {
            name: review.userId?.name || review.userId?.username || 'Usuário',
            avatar: review.userId?.avatar
          },
          target: {
            name: review.targetId?.name || review.targetId?.username || 'Usuário'
          }
        })),
        stats
      }
    };
    
    return res.json(response);
  } catch (error) {
    console.error('[HOME DATA ERROR]', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Erro ao carregar dados da homepage',
      error: error.message 
    });
  }
});

// GET /api/home/featured - Items em destaque
router.get('/featured', optionalAuth, async (req, res) => {
  try {
    const userId = req.user?._id;
    const isBanned = req.user?.status === 'banned';
    
    if (!userId || isBanned) {
      return res.status(403).json({ 
        success: false, 
        message: 'Acesso negado. Faça login para ver items em destaque.' 
      });
    }
    
    const featuredItems = await MarketItem.find({ 
      status: 'active',
      featured: true,
      stock: { $gt: 0 }
    })
      .sort({ createdAt: -1 })
      .limit(6)
      .populate('sellerId', 'name username avatar')
      .lean();
    
    return res.json({
      success: true,
      data: featuredItems
    });
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      message: 'Erro ao carregar items em destaque' 
    });
  }
});

module.exports = router;

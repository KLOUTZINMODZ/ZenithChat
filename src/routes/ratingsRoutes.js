const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Review = require('../models/Review');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const Agreement = require('../models/Agreement');

function summarizeVoteCounts(reviewDoc) {
  const helpful = (reviewDoc.helpfulVotes || []).filter(v => v.vote === 'helpful').length;
  const notHelpful = (reviewDoc.helpfulVotes || []).filter(v => v.vote === 'not_helpful').length;
  return { helpful, notHelpful };
}

// POST /api/ratings
// Body: { purchaseId, rating, title?, comment? }
router.post('/', auth, async (req, res) => {
  try {
    const { purchaseId, rating, title, comment } = req.body || {};
    if (!purchaseId || !rating) {
      return res.status(400).json({ success: false, message: 'purchaseId e rating são obrigatórios' });
    }

    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Compra não encontrada' });

    // Only buyer can review and only after completion
    if (purchase.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Apenas o comprador pode avaliar' });
    }
    if (String(purchase.status) !== 'completed') {
      return res.status(400).json({ success: false, message: 'A compra precisa estar concluída para avaliação' });
    }

    const existing = await Review.findOne({ purchaseId: purchase._id });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Esta compra já foi avaliada' });
    }

    const doc = await Review.create({
      userId: purchase.buyerId,
      targetId: purchase.sellerId,
      targetType: 'User',
      purchaseId: purchase._id,
      rating: Math.max(1, Math.min(5, Number(rating))),
      title: title ? String(title).slice(0, 100) : null,
      comment: comment ? String(comment).slice(0, 1500) : null,
      isVerifiedPurchase: true,
      status: 'approved'
    });

    // Atualizar rating do vendedor
    try {
      const allSellerReviews = await Review.find({ 
        targetId: purchase.sellerId,
        status: 'approved'
      });
      
      if (allSellerReviews.length > 0) {
        const totalRating = allSellerReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
        const averageRating = totalRating / allSellerReviews.length;
        
        console.log(`[RATING UPDATE] Seller ${purchase.sellerId}: ${allSellerReviews.length} reviews, avg: ${averageRating.toFixed(2)}`);
        
        await User.findByIdAndUpdate(purchase.sellerId, {
          rating: Number(averageRating.toFixed(2))
        });
      }
    } catch (err) {
      console.error('[RATING UPDATE] Erro ao atualizar rating do vendedor:', err);
    }

    const populated = await Review.findById(doc._id)
      .populate('userId', 'name avatar profileImage')
      .lean();

    const { helpful, notHelpful } = summarizeVoteCounts(populated);

    return res.status(201).json({ success: true, data: {
      ...populated,
      isHelpful: helpful,
      isNotHelpful: notHelpful,
      orderStatus: 'completed'
    }});
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao criar avaliação', error: error.message });
  }
});

// GET /api/ratings/user/:userId?page&limit
router.get('/user/:userId', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const emailAlias = String(req.query.email || '').trim();
    let targetIdRaw = req.params.userId;
    let targetObjectId = null;

    // Prefer resolving by email when provided
    if (emailAlias) {
      try {
        const u = await User.findOne({ email: emailAlias }).select('_id').lean();
        if (u?._id) targetIdRaw = String(u._id);
      } catch (_) {}
    }

    if (mongoose.Types.ObjectId.isValid(targetIdRaw)) {
      try { targetObjectId = new mongoose.Types.ObjectId(targetIdRaw); } catch (_) { targetObjectId = null; }
    }

    // If after resolving we still don't have a valid ObjectId, return empty payload gracefully
    if (!targetObjectId) {
      return res.json({ success: true, data: {
        ratings: [],
        stats: { average: 0, count: 0, distribution: { 5:0, 4:0, 3:0, 2:0, 1:0 } },
        pagination: { total: 0, page: 1, limit: Number(req.query.limit || 10), pages: 0 }
      }});
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '10')) || 10));
    const skip = (page - 1) * limit;

    const filter = { targetId: targetObjectId, status: 'approved' };

    let total = 0, ratings = [];
    try {
      [total, ratings] = await Promise.all([
        Review.countDocuments(filter),
        Review.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('userId', 'name avatar profileImage')
          .lean()
      ]);
    } catch (e) {
      // If anything goes wrong, return empty to avoid 500 and help caller degrade gracefully
      return res.json({ success: true, data: {
        ratings: [],
        stats: { average: 0, count: 0, distribution: { 5:0, 4:0, 3:0, 2:0, 1:0 } },
        pagination: { total: 0, page, limit, pages: 0 }
      }});
    }

    // Stats via aggregation (guarded)
    let distributionDocs = [];
    try {
      distributionDocs = await Review.aggregate([
        { $match: { targetId: targetObjectId, status: 'approved' } },
        { $group: { _id: '$rating', count: { $sum: 1 } } }
      ]);
    } catch (_) {}

    const distMap = new Map((distributionDocs || []).map(d => [String(d._id), d.count]));
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (let i = 1; i <= 5; i++) distribution[i] = Number(distMap.get(String(i)) || 0);
    const count = Number(total) || 0;
    const avgFromDist = count > 0
      ? (distributionDocs.reduce((sum, d) => sum + (Number(d._id) * Number(d.count || 0)), 0) / count)
      : 0;

    const formatted = (ratings || []).map(r => {
      const { helpful, notHelpful } = summarizeVoteCounts(r);
      return { ...r, isHelpful: helpful, isNotHelpful: notHelpful, orderStatus: 'completed' };
    });

    return res.json({ success: true, data: {
      ratings: formatted,
      stats: { average: Number((avgFromDist || 0).toFixed(2)), count, distribution },
      pagination: { total: count, page, limit, pages: Math.ceil(count / limit) }
    }});
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar avaliações', error: error.message });
  }
});

// GET /api/ratings/:reviewId/vote-status
router.get('/:reviewId/vote-status', auth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const review = await Review.findById(reviewId);
    if (!review) return res.status(404).json({ success: false, message: 'Avaliação não encontrada' });
    const vote = (review.helpfulVotes || []).find(v => v.userId.toString() === req.user._id.toString());
    return res.json({ success: true, data: { hasVoted: !!vote, userVote: vote ? vote.vote : null } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao obter status de voto', error: error.message });
  }
});

// POST /api/ratings/:reviewId/helpful { isHelpful }
router.post('/:reviewId/helpful', auth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { isHelpful } = req.body || {};
    const review = await Review.findById(reviewId);
    if (!review) return res.status(404).json({ success: false, message: 'Avaliação não encontrada' });

    // Do not allow author to vote on their own review
    if (review.userId.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Você não pode votar na sua própria avaliação' });
    }

    const already = (review.helpfulVotes || []).find(v => v.userId.toString() === req.user._id.toString());
    if (already) {
      return res.json({ success: true, data: { hasVoted: true, userVote: already.vote, ...summarizeVoteCounts(review) } });
    }

    review.helpfulVotes.push({ userId: req.user._id, vote: isHelpful ? 'helpful' : 'not_helpful' });
    await review.save();

    const counts = summarizeVoteCounts(review);
    return res.json({ success: true, data: { hasVoted: true, userVote: isHelpful ? 'helpful' : 'not_helpful', isHelpful: counts.helpful, isNotHelpful: counts.notHelpful } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao registrar voto', error: error.message });
  }
});

// POST /api/ratings/boosting/:agreementId
// Body: { rating, comment }
router.post('/boosting/:agreementId', auth, async (req, res) => {
  try {
    const { agreementId } = req.params;
    const { rating, comment } = req.body || {};
    
    if (!rating) {
      return res.status(400).json({ success: false, message: 'Rating é obrigatório' });
    }

    if (!comment || comment.trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Comentário deve ter pelo menos 10 caracteres' });
    }

    // Buscar agreement por _id ou agreementId
    let agreement = await Agreement.findById(agreementId);
    if (!agreement) {
      agreement = await Agreement.findOne({ agreementId });
    }
    
    if (!agreement) {
      return res.status(404).json({ success: false, message: 'Boosting não encontrado' });
    }

    // Verificar se é o cliente
    const userId = req.user._id.toString();
    if (agreement.parties?.client?.userid?.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Apenas o cliente pode avaliar este serviço' });
    }

    // Verificar se está completo
    if (agreement.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'O boosting precisa estar concluído para avaliação' });
    }

    // Verificar se já foi avaliado
    const existing = await Review.findOne({ 
      agreementId: agreement._id,
      targetType: 'Boosting'
    });
    
    if (existing) {
      return res.status(409).json({ success: false, message: 'Este boosting já foi avaliado' });
    }

    // Criar avaliação
    const boosterId = agreement.parties?.booster?.userid;
    const review = await Review.create({
      userId: agreement.parties.client.userid,
      targetId: boosterId,
      targetType: 'Boosting',
      agreementId: agreement._id,
      rating: Math.max(1, Math.min(5, Number(rating))),
      comment: String(comment).trim().slice(0, 1500),
      isVerifiedPurchase: true,
      status: 'approved'
    });

    // Atualizar rating do booster
    try {
      console.log(`[BOOSTING RATING] Atualizando rating para booster: ${boosterId}`);
      
      const allBoosterReviews = await Review.find({ 
        targetId: boosterId,
        status: 'approved'
      });
      
      console.log(`[BOOSTING RATING] Encontradas ${allBoosterReviews.length} avaliações para o booster`);
      
      if (allBoosterReviews.length > 0) {
        const totalRating = allBoosterReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
        const averageRating = totalRating / allBoosterReviews.length;
        
        console.log(`[BOOSTING RATING] Média calculada: ${averageRating.toFixed(2)} (${totalRating}/${allBoosterReviews.length})`);
        
        const updateResult = await User.findByIdAndUpdate(
          boosterId, 
          { rating: Number(averageRating.toFixed(2)) },
          { new: true }
        );
        
        if (updateResult) {
          console.log(`[BOOSTING RATING] Rating atualizado com sucesso! Novo rating: ${updateResult.rating}`);
        } else {
          console.error(`[BOOSTING RATING] ❌ Usuário não encontrado: ${boosterId}`);
        }
      } else {
        console.log(`[BOOSTING RATING] Nenhuma avaliação encontrada ainda`);
      }
    } catch (err) {
      console.error('[BOOSTING RATING] ❌ Erro ao atualizar rating do booster:', err);
      console.error('[BOOSTING RATING] Stack:', err.stack);
    }

    const populated = await Review.findById(review._id)
      .populate('userId', 'name avatar profileImage')
      .lean();

    const { helpful, notHelpful } = summarizeVoteCounts(populated);

    return res.status(201).json({ 
      success: true, 
      message: 'Avaliação enviada com sucesso',
      data: {
        ...populated,
        isHelpful: helpful,
        isNotHelpful: notHelpful
      }
    });
  } catch (error) {
    console.error('Erro ao criar avaliação de boosting:', error);
    return res.status(500).json({ success: false, message: 'Erro ao criar avaliação', error: error.message });
  }
});

module.exports = router;

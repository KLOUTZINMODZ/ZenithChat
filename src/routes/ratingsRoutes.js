const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Review = require('../models/Review');
const Purchase = require('../models/Purchase');
const User = require('../models/User');

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

    const populated = await Review.findById(doc._id)
      .populate('userId', 'name email avatar profileImage')
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
    const targetId = req.params.userId;
    const page = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '10')) || 10));
    const skip = (page - 1) * limit;

    const [total, ratings] = await Promise.all([
      Review.countDocuments({ targetId, status: 'approved' }),
      Review.find({ targetId, status: 'approved' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email avatar profileImage')
        .lean()
    ]);

    // Stats
    const pipeline = [
      { $match: { targetId: require('mongoose').Types.ObjectId(targetId), status: 'approved' } },
      { $group: { _id: '$rating', count: { $sum: 1 } } }
    ];
    let distributionDocs = [];
    try { distributionDocs = await Review.aggregate(pipeline); } catch (_) {}
    const distMap = new Map(distributionDocs.map(d => [String(d._id), d.count]));
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (let i = 1; i <= 5; i++) distribution[i] = Number(distMap.get(String(i)) || 0);
    const count = total;
    const average = count > 0 ? (ratings.reduce((acc, r) => acc + Number(r.rating || 0), 0) + (skip > 0 ? 0 : 0)) / Math.max(1, ratings.length) : 0;

    const formatted = ratings.map(r => {
      const { helpful, notHelpful } = summarizeVoteCounts(r);
      return {
        ...r,
        isHelpful: helpful,
        isNotHelpful: notHelpful,
        orderStatus: 'completed'
      };
    });

    return res.json({ success: true, data: {
      ratings: formatted,
      stats: { average: Number((distributionDocs.length ? (distributionDocs.reduce((a, d) => a + d._id * d.count, 0) / Math.max(1, count)) : 0).toFixed(2)), count, distribution },
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

module.exports = router;

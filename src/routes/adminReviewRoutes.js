const express = require('express');
const router = express.Router();
const { auth, adminAuth } = require('../middleware/auth');
const Review = require('../models/Review');
const User = require('../models/User');

// GET /api/admin/reviews - Listar todas as avaliações com filtros e pesquisa
router.get('/reviews', auth, adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      type = 'all', // 'all', 'ratings', 'comments'
      status = 'all', // 'all', 'approved', 'pending', 'rejected'
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Construir filtros
    const filter = {};

    // Filtro de status
    if (status !== 'all') {
      filter.status = status;
    }

    // Filtro de tipo (ratings = sem comentário, comments = com comentário)
    if (type === 'ratings') {
      filter.$or = [
        { comment: null },
        { comment: '' }
      ];
    } else if (type === 'comments') {
      filter.comment = { $exists: true, $ne: '', $ne: null };
    }

    // Busca (pesquisa por nome de usuário, comentário ou título)
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      
      // Buscar usuários que correspondem à pesquisa
      const users = await User.find({
        $or: [
          { name: searchRegex },
          { email: searchRegex }
        ]
      }).select('_id').lean();
      
      const userIds = users.map(u => u._id);

      filter.$or = [
        { comment: searchRegex },
        { title: searchRegex },
        { userId: { $in: userIds } },
        { targetId: { $in: userIds } }
      ];
    }

    // Ordenação
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Executar queries
    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        // ⚠️ ADMIN: Email necessário para identificação/moderação
        .populate('userId', 'name email avatar profileImage')
        .populate('targetId', 'name email avatar profileImage rating')
        .lean(),
      Review.countDocuments(filter)
    ]);

    // Estatísticas gerais
    const stats = await Review.aggregate([
      { $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        totalApproved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        totalPending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        totalRejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
        totalWithComments: { $sum: { $cond: [{ $and: [{ $ne: ['$comment', null] }, { $ne: ['$comment', ''] }] }, 1, 0] } },
        avgRating: { $avg: '$rating' }
      }}
    ]);

    return res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        },
        stats: stats[0] || {
          totalReviews: 0,
          totalApproved: 0,
          totalPending: 0,
          totalRejected: 0,
          totalWithComments: 0,
          avgRating: 0
        }
      }
    });
  } catch (error) {
    console.error('Erro ao listar reviews admin:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao listar avaliações',
      error: error.message
    });
  }
});

// GET /api/admin/reviews/:id - Obter detalhes de uma avaliação
router.get('/reviews/:id', auth, adminAuth, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate('userId', 'name email avatar profileImage userid')
      .populate('targetId', 'name email avatar profileImage userid rating')
      .populate('purchaseId')
      .populate('agreementId')
      .lean();

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Avaliação não encontrada'
      });
    }

    return res.json({
      success: true,
      data: review
    });
  } catch (error) {
    console.error('Erro ao obter review:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao obter avaliação',
      error: error.message
    });
  }
});

// PUT /api/admin/reviews/:id - Editar uma avaliação
router.put('/reviews/:id', auth, adminAuth, async (req, res) => {
  try {
    const { rating, title, comment, status } = req.body;

    const updateData = {};
    
    if (rating !== undefined) {
      updateData.rating = Math.max(1, Math.min(5, Number(rating)));
    }
    
    if (title !== undefined) {
      updateData.title = title ? String(title).slice(0, 100) : null;
    }
    
    if (comment !== undefined) {
      updateData.comment = comment ? String(comment).slice(0, 1500) : null;
    }
    
    if (status !== undefined && ['approved', 'pending', 'rejected'].includes(status)) {
      updateData.status = status;
    }

    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    ).populate('userId', 'name email avatar profileImage')
     .populate('targetId', 'name email avatar profileImage rating');

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Avaliação não encontrada'
      });
    }

    // Se o status mudou para approved ou o rating foi alterado, recalcular média do target
    if (updateData.status === 'approved' || updateData.rating !== undefined) {
      try {
        const allTargetReviews = await Review.find({
          targetId: review.targetId._id,
          status: 'approved'
        });

        if (allTargetReviews.length > 0) {
          const totalRating = allTargetReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
          const averageRating = totalRating / allTargetReviews.length;

          await User.findByIdAndUpdate(review.targetId._id, {
            rating: Number(averageRating.toFixed(2))
          });
        }
      } catch (err) {
        console.error('Erro ao atualizar rating do usuário:', err);
      }
    }

    return res.json({
      success: true,
      message: 'Avaliação atualizada com sucesso',
      data: review
    });
  } catch (error) {
    console.error('Erro ao editar review:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao editar avaliação',
      error: error.message
    });
  }
});

// DELETE /api/admin/reviews/:id - Deletar uma avaliação
router.delete('/reviews/:id', auth, adminAuth, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Avaliação não encontrada'
      });
    }

    const targetId = review.targetId;

    await Review.findByIdAndDelete(req.params.id);

    // Recalcular média do usuário avaliado
    try {
      const remainingReviews = await Review.find({
        targetId,
        status: 'approved'
      });

      if (remainingReviews.length > 0) {
        const totalRating = remainingReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
        const averageRating = totalRating / remainingReviews.length;

        await User.findByIdAndUpdate(targetId, {
          rating: Number(averageRating.toFixed(2))
        });
      } else {
        // Se não há mais reviews, zerar o rating
        await User.findByIdAndUpdate(targetId, { rating: 0 });
      }
    } catch (err) {
      console.error('Erro ao recalcular rating após deleção:', err);
    }

    return res.json({
      success: true,
      message: 'Avaliação deletada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar review:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao deletar avaliação',
      error: error.message
    });
  }
});

// DELETE /api/admin/reviews/bulk - Deletar múltiplas avaliações
router.delete('/reviews/bulk/delete', auth, adminAuth, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'IDs inválidos'
      });
    }

    // Buscar reviews antes de deletar para recalcular ratings
    const reviews = await Review.find({ _id: { $in: ids } }).select('targetId');
    const affectedTargets = [...new Set(reviews.map(r => r.targetId.toString()))];

    const result = await Review.deleteMany({ _id: { $in: ids } });

    // Recalcular rating de todos os usuários afetados
    for (const targetId of affectedTargets) {
      try {
        const remainingReviews = await Review.find({
          targetId,
          status: 'approved'
        });

        if (remainingReviews.length > 0) {
          const totalRating = remainingReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
          const averageRating = totalRating / remainingReviews.length;

          await User.findByIdAndUpdate(targetId, {
            rating: Number(averageRating.toFixed(2))
          });
        } else {
          await User.findByIdAndUpdate(targetId, { rating: 0 });
        }
      } catch (err) {
        console.error(`Erro ao recalcular rating para usuário ${targetId}:`, err);
      }
    }

    return res.json({
      success: true,
      message: `${result.deletedCount} avaliações deletadas com sucesso`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Erro ao deletar reviews em massa:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao deletar avaliações',
      error: error.message
    });
  }
});

// PATCH /api/admin/reviews/bulk/status - Alterar status de múltiplas avaliações
router.patch('/reviews/bulk/status', auth, adminAuth, async (req, res) => {
  try {
    const { ids, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'IDs inválidos'
      });
    }

    if (!['approved', 'pending', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status inválido'
      });
    }

    const result = await Review.updateMany(
      { _id: { $in: ids } },
      { $set: { status } }
    );

    // Se mudou para approved, recalcular ratings
    if (status === 'approved') {
      const reviews = await Review.find({ _id: { $in: ids } }).select('targetId');
      const affectedTargets = [...new Set(reviews.map(r => r.targetId.toString()))];

      for (const targetId of affectedTargets) {
        try {
          const allReviews = await Review.find({
            targetId,
            status: 'approved'
          });

          if (allReviews.length > 0) {
            const totalRating = allReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
            const averageRating = totalRating / allReviews.length;

            await User.findByIdAndUpdate(targetId, {
              rating: Number(averageRating.toFixed(2))
            });
          }
        } catch (err) {
          console.error(`Erro ao recalcular rating para usuário ${targetId}:`, err);
        }
      }
    }

    return res.json({
      success: true,
      message: `${result.modifiedCount} avaliações atualizadas`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Erro ao atualizar status em massa:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao atualizar status',
      error: error.message
    });
  }
});

module.exports = router;

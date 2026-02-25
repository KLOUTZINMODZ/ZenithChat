const User = require('../models/User');
const Purchase = require('../models/Purchase');
const PromoCode = require('../models/PromoCode');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

const influencerController = {
    /**
     * List all influencers
     */
    getInfluencers: async (req, res) => {
        try {
            const influencers = await User.find({ isInfluencer: true })
                .select('_id name email avatar isInfluencer influencerSettings createdAt')
                .sort('-createdAt')
                .lean();

            return res.json({ success: true, data: influencers });
        } catch (error) {
            logger.error('Error fetching influencers:', error);
            return res.status(500).json({ success: false, message: 'Erro ao buscar influenciadores' });
        }
    },

    /**
     * Update influencer settings or status
     */
    updateInfluencer: async (req, res) => {
        try {
            const { userId } = req.params;
            const { isInfluencer, influencerSettings, role } = req.body;

            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return res.status(400).json({ success: false, message: 'ID de usuário inválido' });
            }

            const updates = {};
            if (isInfluencer !== undefined) updates.isInfluencer = !!isInfluencer;

            // Handle role change if provided
            if (role !== undefined) {
                // If removing influencer status, check if role was influencer and revert to user
                if (!isInfluencer && role === 'user') {
                    updates.role = 'user';
                } else if (isInfluencer && role === 'influencer') {
                    updates.role = 'influencer';
                } else {
                    updates.role = role;
                }
            } else if (isInfluencer !== undefined) {
                // Auto-sync role if not explicitly provided
                if (isInfluencer) {
                    updates.role = 'influencer';
                    // Initialize default settings if not already present
                    updates.influencerSettings = {
                        buyerDiscountDefault: 0,
                        influencerCommissionDefault: 0,
                        mediatorCommissionDefault: 0
                    };
                } else {
                    // Only revert to user if currently influencer
                    const currentUser = await User.findById(userId).select('role');
                    if (currentUser && currentUser.role === 'influencer') {
                        updates.role = 'user';
                    }
                }
            }

            if (influencerSettings) {
                updates.influencerSettings = {
                    buyerDiscountDefault: Number(influencerSettings.buyerDiscountDefault) || 0,
                    influencerCommissionDefault: Number(influencerSettings.influencerCommissionDefault) || 0,
                    mediatorCommissionDefault: Number(influencerSettings.mediatorCommissionDefault) || 0
                };

                // Validate 5% cap
                const total = (updates.influencerSettings.buyerDiscountDefault || 0) +
                    (updates.influencerSettings.influencerCommissionDefault || 0) +
                    (updates.influencerSettings.mediatorCommissionDefault || 0);

                if (total > 5.001) {
                    return res.status(400).json({ success: false, message: 'O total das taxas não pode exceder 5%' });
                }
            }

            const user = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true })
                .select('_id name email isInfluencer influencerSettings role');

            if (!user) {
                return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
            }

            return res.json({ success: true, data: user });
        } catch (error) {
            logger.error('Error updating influencer:', error);
            return res.status(500).json({ success: false, message: 'Erro ao atualizar influenciador' });
        }
    },

    /**
     * Search users to be promoted to influencers
     */
    searchUsers: async (req, res) => {
        try {
            const { query } = req.query;
            if (!query || query.length < 2) {
                return res.json({ success: true, data: [] });
            }

            const users = await User.find({
                $and: [
                    { isInfluencer: { $ne: true } }, // Only non-influencers
                    {
                        $or: [
                            { name: { $regex: query, $options: 'i' } },
                            { email: { $regex: query, $options: 'i' } }
                        ]
                    }
                ]
            })
                .select('_id name email avatar')
                .limit(10)
                .lean();

            return res.json({ success: true, data: users });
        } catch (error) {
            logger.error('Error searching users for influencer promotion:', error);
            return res.status(500).json({ success: false, message: 'Erro ao buscar usuários' });
        }
    },

    /**
     * Get performance stats for an influencer
     */
    getInfluencerStats: async (req, res) => {
        try {
            const { userId } = req.params;

            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return res.status(400).json({ success: false, message: 'ID de usuário inválido' });
            }

            // Stats from completed purchases
            const stats = await Purchase.aggregate([
                { $match: { influencerId: new mongoose.Types.ObjectId(userId), status: 'completed' } },
                {
                    $group: {
                        _id: null,
                        totalSales: { $sum: 1 },
                        totalVolume: { $sum: '$price' },
                        totalCommission: { $sum: '$influencerCommission' }
                    }
                }
            ]);

            const influencerStats = stats[0] || { totalSales: 0, totalVolume: 0, totalCommission: 0 };

            // Get active coupons for this influencer
            const coupons = await PromoCode.find({ influencerId: userId, isInfluencerCoupon: true })
                .select('code currentUses maxUses status')
                .lean();

            // Get referred users count
            const referredCount = await User.countDocuments({ referredBy: userId });

            return res.json({
                success: true,
                data: {
                    ...influencerStats,
                    activeCoupons: coupons.length,
                    couponDetails: coupons,
                    referredUsersCount: referredCount
                }
            });
        } catch (error) {
            logger.error('Error fetching influencer stats:', error);
            return res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas do influenciador' });
        }
    },

    /**
     * Create a new coupon for an influencer
     */
    createInfluencerCoupon: async (req, res) => {
        try {
            const { userId } = req.params;
            const { code, discount, commission, mediatorCommission } = req.body;

            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return res.status(400).json({ success: false, message: 'ID de usuário inválido' });
            }

            if (!code || code.length < 3) {
                return res.status(400).json({ success: false, message: 'Código inválido (mínimo 3 caracteres)' });
            }

            // Check if coupon already exists
            const existing = await PromoCode.findOne({ code: code.toUpperCase() });
            if (existing) {
                return res.status(400).json({ success: false, message: 'Este código de cupom já existe' });
            }

            // Validate commissions
            const total = (Number(discount) || 0) + (Number(commission) || 0) + (Number(mediatorCommission) || 0);
            if (total > 5.001) {
                return res.status(400).json({ success: false, message: 'O total das taxas não pode exceder 5%' });
            }

            const promoCode = new PromoCode({
                code: code.toUpperCase(),
                type: 'percentage',
                value: 0, // In this system, 'value' might be used for generic discounts, but we use commissionSplit for influencers
                status: 'active',
                influencerId: userId,
                isInfluencerCoupon: true,
                commissionSplit: {
                    buyerDiscount: Number(discount) || 0,
                    influencerCommission: Number(commission) || 0,
                    mediatorCommission: Number(mediatorCommission) || 0
                }
            });

            await promoCode.save();

            return res.json({ success: true, data: promoCode });
        } catch (error) {
            logger.error('Error creating influencer coupon:', error);
            return res.status(500).json({ success: false, message: 'Erro ao criar cupom' });
        }
    },

    /**
     * Delete an influencer coupon
     */
    deleteInfluencerCoupon: async (req, res) => {
        try {
            const { userId, couponId } = req.params;

            if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(couponId)) {
                return res.status(400).json({ success: false, message: 'IDs inválidos' });
            }

            const result = await PromoCode.findOneAndDelete({
                _id: couponId,
                influencerId: userId
            });

            if (!result) {
                return res.status(404).json({ success: false, message: 'Cupom não encontrado' });
            }

            return res.json({ success: true, message: 'Cupom excluído com sucesso' });
        } catch (error) {
            logger.error('Error deleting influencer coupon:', error);
            return res.status(500).json({ success: false, message: 'Erro ao excluir cupom' });
        }
    }
};

module.exports = influencerController;

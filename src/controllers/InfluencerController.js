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
            const { isInfluencer, influencerSettings } = req.body;

            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return res.status(400).json({ success: false, message: 'ID de usuário inválido' });
            }

            const updates = {};
            if (isInfluencer !== undefined) updates.isInfluencer = !!isInfluencer;
            if (influencerSettings) {
                updates.influencerSettings = {
                    buyerDiscountDefault: Number(influencerSettings.buyerDiscountDefault) || 0,
                    influencerCommissionDefault: Number(influencerSettings.influencerCommissionDefault) || 0,
                    mediatorCommissionDefault: Number(influencerSettings.mediatorCommissionDefault) || 0
                };

                // Validate 5% cap
                const total = updates.influencerSettings.buyerDiscountDefault +
                    updates.influencerSettings.influencerCommissionDefault +
                    updates.influencerSettings.mediatorCommissionDefault;

                if (total > 5.001) { // Floating point tolerance
                    return res.status(400).json({ success: false, message: 'O total das taxas não pode exceder 5%' });
                }
            }

            const user = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true })
                .select('_id name email isInfluencer influencerSettings');

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
    }
};

module.exports = influencerController;

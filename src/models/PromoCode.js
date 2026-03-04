const mongoose = require('mongoose');

const promoCodeSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['fixed', 'percentage'],
        required: true,
        default: 'fixed'
    },
    value: {
        type: Number,
        required: true,
        min: 0
    },
    validFrom: {
        type: Date,
        default: Date.now
    },
    validUntil: {
        type: Date,
        default: null // null means no expiration
    },
    maxUses: {
        type: Number,
        default: null // null means unlimited
    },
    currentUses: {
        type: Number,
        default: 0
    },
    users: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        redeemedAt: {
            type: Date,
            default: Date.now
        },
        cpfCnpj: String
    }],
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    description: {
        type: String,
        trim: true
    },
    // Influencer Fields
    influencerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    isInfluencerCoupon: {
        type: Boolean,
        default: false
    },
    commissionSplit: {
        buyerDiscount: { type: Number, default: 0, min: 0, max: 15 },
        influencerCommission: { type: Number, default: 0, min: 0, max: 15 },
        mediatorCommission: { type: Number, default: 5, min: 0, max: 15 }
    }
}, { timestamps: true });

// Indexes for faster lookups
promoCodeSchema.index({ code: 1 }, { unique: true });
promoCodeSchema.index({ status: 1 });

module.exports = mongoose.model('PromoCode', promoCodeSchema);

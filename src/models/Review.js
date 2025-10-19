const mongoose = require('mongoose');

const helpfulVoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  vote: { type: String, enum: ['helpful', 'not_helpful'], required: true },
  at: { type: Date, default: Date.now }
}, { _id: false });

const reviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // reviewer (buyer/client)
  targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // reviewed (seller/booster)
  targetType: { type: String, enum: ['User', 'Boosting'], default: 'User' },
  purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase' }, // Para marketplace
  agreementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agreement' }, // Para boosting
  rating: { type: Number, min: 1, max: 5, required: true },
  title: { type: String, default: null },
  comment: { type: String, default: null },
  isVerifiedPurchase: { type: Boolean, default: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
  helpfulVotes: { type: [helpfulVoteSchema], default: [] }
}, { timestamps: true });

// Índices compostos
reviewSchema.index({ targetId: 1, createdAt: -1 });
reviewSchema.index({ purchaseId: 1 }, { sparse: true, unique: true }); // Único por compra, ignora null
reviewSchema.index({ agreementId: 1 }, { sparse: true, unique: true }); // Único por acordo, ignora null

module.exports = mongoose.model('Review', reviewSchema);

const mongoose = require('mongoose');

const helpfulVoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  vote: { type: String, enum: ['helpful', 'not_helpful'], required: true },
  at: { type: Date, default: Date.now }
}, { _id: false });

const reviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // reviewer (buyer)
  targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // reviewed (seller)
  targetType: { type: String, enum: ['User'], default: 'User' },
  purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', required: true, unique: true }, // 1 review por compra
  rating: { type: Number, min: 1, max: 5, required: true },
  title: { type: String, default: null },
  comment: { type: String, default: null },
  isVerifiedPurchase: { type: Boolean, default: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
  helpfulVotes: { type: [helpfulVoteSchema], default: [] }
}, { timestamps: true });

reviewSchema.index({ targetId: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);

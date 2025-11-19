const mongoose = require('mongoose');

const qaQuestionSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MarketItem',
    required: true,
    index: true
  },
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  question: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000
  },
  answer: {
    type: String,
    trim: true,
    maxlength: 5000,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'answered'],
    default: 'pending',
    index: true
  },
  buyerSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  sellerSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  answeredAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: false
});

qaQuestionSchema.index({ itemId: 1, createdAt: -1 });
qaQuestionSchema.index({ buyerId: 1, createdAt: -1 });

module.exports = mongoose.model('QAQuestion', qaQuestionSchema);

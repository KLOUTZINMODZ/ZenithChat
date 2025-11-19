const mongoose = require('mongoose');

const marketItemSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  image: {
    type: String,
    required: false
  },
  images: {
    type: [String],
    default: []
  },
  category: {
    type: String,
    required: true
  },
  // Inventory controls (optional for non-account items)
  stock: {
    type: Number,
    min: 0,
    max: 9999,
    default: undefined
  },
  stockLeft: {
    type: Number,
    min: 0,
    default: undefined
  },
  reservedCount: {
    type: Number,
    min: 0,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'reserved', 'sold'],
    default: 'active'
  },
  reservedAt: {
    type: Date,
    required: false
  },
  soldAt: {
    type: Date,
    required: false
  },
  isHighlighted: {
    type: Boolean,
    default: false
  },
  highlightExpiry: {
    type: Date,
    required: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

marketItemSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('MarketItem', marketItemSchema);

const mongoose = require('mongoose');

const boostingRequestSchema = new mongoose.Schema({
  clientId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  currentRank: { type: String },
  desiredRank: { type: String },
  minPrice: { type: Number, required: true },
  gameId: { type: Number },
  game: { type: String },
  title: { type: String },
  description: { type: String },
  price: { type: Number },
  status: { 
    type: String, 
    enum: ['open', 'in_progress', 'completed', 'cancelled'],
    default: 'open'
  },
  boostingCategory: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

boostingRequestSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('BoostingRequest', boostingRequestSchema, 'boostingrequests');

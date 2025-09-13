const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  itemId: { type: String, required: true, index: true },
  price: { type: Number, required: true },
  feePercent: { type: Number, default: 0 },
  feeAmount: { type: Number, default: 0 },
  sellerReceives: { type: Number, required: true },

  status: { type: String, enum: [
    'initiated',
    'escrow_reserved',
    'shipped',
    'delivered',
    'completed',
    'cancelled',
    'disputed'
  ], default: 'initiated', index: true },

  escrowReservedAt: { type: Date },
  shippedAt: { type: Date },
  deliveredAt: { type: Date },
  autoReleaseAt: { type: Date, index: true },
  cancelledAt: { type: Date },

  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', index: true },

  buyerInfo: {
    fullName: { type: String },
    cpf: { type: String, index: true },
    birthDate: { type: Date },
    email: { type: String }
  },

  logs: [{
    at: { type: Date, default: Date.now },
    level: { type: String, enum: ['info','warn','error'], default: 'info' },
    message: { type: String },
    data: { type: Object }
  }]
}, { timestamps: true });

purchaseSchema.index({ buyerId: 1, itemId: 1, status: 1 });

module.exports = mongoose.model('Purchase', purchaseSchema);

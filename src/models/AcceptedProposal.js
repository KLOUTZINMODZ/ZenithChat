const mongoose = require('mongoose');

const acceptedProposalSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  proposalId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  game: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  currentRank: String,
  desiredRank: String,
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  originalPrice: Number,
  estimatedTime: {
    type: String,
    required: true
  },
  // Dados completos do cliente
  client: {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    email: String,
    avatar: String,
    isVerified: {
      type: Boolean,
      default: false
    },
    totalOrders: {
      type: Number,
      default: 0
    },
    rating: {
      type: Number,
      default: 0
    },
    registeredAt: Date
  },
  // Dados completos do booster
  booster: {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    email: String,
    avatar: String,
    isVerified: {
      type: Boolean,
      default: false
    },
    rating: {
      type: Number,
      default: 0
    },
    totalBoosts: {
      type: Number,
      default: 0
    },
    completedBoosts: {
      type: Number,
      default: 0
    },
    specializations: [String],
    registeredAt: Date
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled', 'disputed'],
    default: 'active',
    index: true
  },
  acceptedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  completedAt: Date,
  cancelledAt: Date,
  // Histórico de renegociações
  renegotiationHistory: [{
    requestedAt: {
      type: Date,
      default: Date.now
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    previousPrice: Number,
    newPrice: Number,
    previousTime: String,
    newEstimatedTime: String,
    reason: String,
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    }
  }],
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Índices para performance
acceptedProposalSchema.index({ 'client.userid': 1 });
acceptedProposalSchema.index({ 'booster.userid': 1 });
acceptedProposalSchema.index({ status: 1, acceptedAt: -1 });

// Método para adicionar renegociação
acceptedProposalSchema.methods.addRenegotiation = function(requestedBy, newPrice, newEstimatedTime, reason) {
  this.renegotiationHistory.push({
    requestedBy,
    previousPrice: this.price,
    newPrice,
    previousTime: this.estimatedTime,
    newEstimatedTime,
    reason
  });
  return this.save();
};

// Método para completar proposta
acceptedProposalSchema.methods.complete = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  return this.save();
};

// Método para cancelar proposta
acceptedProposalSchema.methods.cancel = function() {
  this.status = 'cancelled';
  this.cancelledAt = new Date();
  return this.save();
};

module.exports = mongoose.model('AcceptedProposal', acceptedProposalSchema);

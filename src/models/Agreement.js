const mongoose = require('mongoose');

const agreementSchema = new mongoose.Schema({

  agreementId: {
    type: String,
    required: true,
    unique: true,
    default: () => `AGR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  

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

  acceptedProposalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcceptedProposal'
  },

  boostingRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BoostingRequest',
    index: true
  },
  
  price: {
    type: Number
  },

  proposalSnapshot: {
    game: { type: String, required: true },
    category: { type: String, required: true },
    currentRank: String,
    desiredRank: String,
    description: { type: String, required: true },
    price: { type: Number, required: true },
    originalPrice: Number,
    estimatedTime: { type: String, required: true }
  },
  

  parties: {
    client: {
      userid: { type: String, required: true },  // Alterado para String (suporta ObjectId e userid numérico)
      name: { type: String, required: true },
      email: String,
      avatar: String,
      metadata: { type: Map, of: mongoose.Schema.Types.Mixed }
    },
    booster: {
      userid: { type: String, required: true },  // Alterado para String (suporta ObjectId e userid numérico)
      name: { type: String, required: true },
      email: String,
      avatar: String,
      rating: Number,
      metadata: { type: Map, of: mongoose.Schema.Types.Mixed }
    }
  },
  

  status: {
    type: String,
    enum: ['pending', 'active', 'completed', 'cancelled', 'expired', 'disputed'],
    default: 'pending',
    index: true
  },
  

  version: {
    type: Number,
    default: 1,
    index: true
  },
  

  createdAt: { type: Date, default: Date.now },
  activatedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  expiredAt: Date,
  lastUpdatedAt: { type: Date, default: Date.now },
  

  actionHistory: [{
    action: {
      type: String,
      enum: ['created', 'activated', 'completed', 'cancelled', 'expired', 'renegotiated', 'disputed'],
      required: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    performedAt: {
      type: Date,
      default: Date.now
    },
    details: {
      type: Map,
      of: mongoose.Schema.Types.Mixed
    },

    idempotencyKey: String
  }],
  

  renegotiationData: {
    originalPrice: Number,
    currentPrice: Number,
    originalTime: String,
    currentEstimatedTime: String,
    renegotiationCount: { type: Number, default: 0 },
    lastRenegotiatedAt: Date,
    lastRenegotiatedBy: mongoose.Schema.Types.ObjectId
  },
  

  financial: {
    totalAmount: Number,
    paidAmount: { type: Number, default: 0 },
    refundAmount: { type: Number, default: 0 },
    currency: { type: String, default: 'BRL' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'escrowed', 'paid', 'refunded', 'partial_refund'],
      default: 'pending'
    }
  },
  

  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true,

  optimisticConcurrency: true
});


agreementSchema.index({ conversationId: 1, status: 1 });
agreementSchema.index({ 'parties.client.userid': 1, status: 1 });
agreementSchema.index({ 'parties.booster.userid': 1, status: 1 });
agreementSchema.index({ status: 1, createdAt: -1 });
agreementSchema.index({ version: 1, lastUpdatedAt: -1 });


agreementSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.version += 1;
    this.lastUpdatedAt = new Date();
  }
  next();
});


agreementSchema.methods.activate = function(performedBy, idempotencyKey) {
  if (this.status !== 'pending') {
    throw new Error(`Cannot activate agreement in status: ${this.status}`);
  }
  
  this.status = 'active';
  this.activatedAt = new Date();
  this.addAction('activated', performedBy, {}, idempotencyKey);
  
  return this.save();
};

agreementSchema.methods.complete = function(performedBy, completionDetails = {}, idempotencyKey) {
  if (this.status !== 'active') {
    throw new Error(`Cannot complete agreement in status: ${this.status}`);
  }
  
  this.status = 'completed';
  this.completedAt = new Date();
  this.addAction('completed', performedBy, completionDetails, idempotencyKey);
  
  return this.save();
};

agreementSchema.methods.cancel = function(performedBy, cancelReason = '', idempotencyKey) {
  if (!['pending', 'active'].includes(this.status)) {
    throw new Error(`Cannot cancel agreement in status: ${this.status}`);
  }
  
  this.status = 'cancelled';
  this.cancelledAt = new Date();
  this.addAction('cancelled', performedBy, { reason: cancelReason }, idempotencyKey);
  
  return this.save();
};

agreementSchema.methods.expire = function(performedBy = null, idempotencyKey) {
  if (!['pending', 'active'].includes(this.status)) {
    throw new Error(`Cannot expire agreement in status: ${this.status}`);
  }
  
  this.status = 'expired';
  this.expiredAt = new Date();
  this.addAction('expired', performedBy || this.parties.client.userid, { reason: 'timeout' }, idempotencyKey);
  
  return this.save();
};


agreementSchema.methods.addAction = function(action, performedBy, details = {}, idempotencyKey = null) {

  if (idempotencyKey) {
    const existingAction = this.actionHistory.find(a => a.idempotencyKey === idempotencyKey);
    if (existingAction) {
      console.log(`Action already performed with key: ${idempotencyKey}`);
      return this;
    }
  }
  
  this.actionHistory.push({
    action,
    performedBy,
    details,
    idempotencyKey,
    performedAt: new Date()
  });
  
  return this;
};


agreementSchema.methods.renegotiate = function(performedBy, newPrice, newEstimatedTime, reason, idempotencyKey) {
  if (this.status !== 'active') {
    throw new Error(`Cannot renegotiate agreement in status: ${this.status}`);
  }
  

  if (!this.renegotiationData.originalPrice) {
    this.renegotiationData.originalPrice = this.proposalSnapshot.price;
    this.renegotiationData.originalTime = this.proposalSnapshot.estimatedTime;
  }
  

  this.renegotiationData.currentPrice = newPrice;
  this.renegotiationData.currentEstimatedTime = newEstimatedTime;
  this.renegotiationData.renegotiationCount += 1;
  this.renegotiationData.lastRenegotiatedAt = new Date();
  this.renegotiationData.lastRenegotiatedBy = performedBy;
  

  this.proposalSnapshot.price = newPrice;
  this.proposalSnapshot.estimatedTime = newEstimatedTime;
  
  this.addAction('renegotiated', performedBy, {
    reason,
    newPrice,
    newEstimatedTime,
    renegotiationCount: this.renegotiationData.renegotiationCount
  }, idempotencyKey);
  
  return this.save();
};


agreementSchema.statics.findByAgreementId = function(agreementId) {
  return this.findOne({ agreementId });
};


agreementSchema.statics.findByConversation = function(conversationId, status = null) {
  const query = { conversationId };
  if (status) query.status = status;
  return this.find(query).sort({ createdAt: -1 });
};


agreementSchema.statics.findByUser = function(userId, role = null, status = null) {
  const query = {};
  
  if (role === 'client') {
    query['parties.client.userid'] = userId;
  } else if (role === 'booster') {
    query['parties.booster.userid'] = userId;
  } else {
    query.$or = [
      { 'parties.client.userid': userId },
      { 'parties.booster.userid': userId }
    ];
  }
  
  if (status) query.status = status;
  
  return this.find(query).sort({ createdAt: -1 });
};

module.exports = mongoose.model('Agreement', agreementSchema);

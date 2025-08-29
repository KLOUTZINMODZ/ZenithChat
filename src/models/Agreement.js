const mongoose = require('mongoose');

const agreementSchema = new mongoose.Schema({
  // Identificação única do acordo
  agreementId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    // Formato: AGR_[timestamp]_[random]
    default: () => `AGR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  
  // Referências
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
  // Referência à proposta aceita original (retrocompatibilidade)
  acceptedProposalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcceptedProposal'
  },
  
  // Dados da proposta (snapshot no momento da aceitação)
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
  
  // Participantes (snapshot)
  parties: {
    client: {
      userid: { type: mongoose.Schema.Types.ObjectId, required: true },
      name: { type: String, required: true },
      email: String,
      avatar: String,
      metadata: { type: Map, of: mongoose.Schema.Types.Mixed }
    },
    booster: {
      userid: { type: mongoose.Schema.Types.ObjectId, required: true },
      name: { type: String, required: true },
      email: String,
      avatar: String,
      rating: Number,
      metadata: { type: Map, of: mongoose.Schema.Types.Mixed }
    }
  },
  
  // Ciclo de vida independente
  status: {
    type: String,
    enum: ['pending', 'active', 'completed', 'cancelled', 'expired', 'disputed'],
    default: 'pending',
    index: true
  },
  
  // Controle de versão e concorrência
  version: {
    type: Number,
    default: 1,
    index: true
  },
  
  // Timestamps detalhados
  createdAt: { type: Date, default: Date.now },
  activatedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  expiredAt: Date,
  lastUpdatedAt: { type: Date, default: Date.now },
  
  // Histórico de ações
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
    // Chave de idempotência para evitar duplicação
    idempotencyKey: String
  }],
  
  // Dados de renegociação
  renegotiationData: {
    originalPrice: Number,
    currentPrice: Number,
    originalTime: String,
    currentEstimatedTime: String,
    renegotiationCount: { type: Number, default: 0 },
    lastRenegotiatedAt: Date,
    lastRenegotiatedBy: mongoose.Schema.Types.ObjectId
  },
  
  // Dados financeiros
  financial: {
    totalAmount: Number,
    paidAmount: { type: Number, default: 0 },
    refundAmount: { type: Number, default: 0 },
    currency: { type: String, default: 'BRL' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'refunded', 'partial_refund'],
      default: 'pending'
    }
  },
  
  // Metadados flexíveis
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true,
  // Otimistic locking automático
  optimisticConcurrency: true
});

// Índices compostos para performance
agreementSchema.index({ conversationId: 1, status: 1 });
agreementSchema.index({ 'parties.client.userid': 1, status: 1 });
agreementSchema.index({ 'parties.booster.userid': 1, status: 1 });
agreementSchema.index({ status: 1, createdAt: -1 });
agreementSchema.index({ version: 1, lastUpdatedAt: -1 });

// Middleware para atualizar version e lastUpdatedAt
agreementSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.version += 1;
    this.lastUpdatedAt = new Date();
  }
  next();
});

// Métodos de transição de estado
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

// Método para adicionar ação ao histórico
agreementSchema.methods.addAction = function(action, performedBy, details = {}, idempotencyKey = null) {
  // Verificar se ação já foi executada (idempotência)
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

// Método para renegociar
agreementSchema.methods.renegotiate = function(performedBy, newPrice, newEstimatedTime, reason, idempotencyKey) {
  if (this.status !== 'active') {
    throw new Error(`Cannot renegotiate agreement in status: ${this.status}`);
  }
  
  // Salvar dados anteriores
  if (!this.renegotiationData.originalPrice) {
    this.renegotiationData.originalPrice = this.proposalSnapshot.price;
    this.renegotiationData.originalTime = this.proposalSnapshot.estimatedTime;
  }
  
  // Aplicar mudanças
  this.renegotiationData.currentPrice = newPrice;
  this.renegotiationData.currentEstimatedTime = newEstimatedTime;
  this.renegotiationData.renegotiationCount += 1;
  this.renegotiationData.lastRenegotiatedAt = new Date();
  this.renegotiationData.lastRenegotiatedBy = performedBy;
  
  // Atualizar snapshot atual
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

// Método estático para buscar por agreement_id
agreementSchema.statics.findByAgreementId = function(agreementId) {
  return this.findOne({ agreementId });
};

// Método estático para buscar acordos de uma conversa
agreementSchema.statics.findByConversation = function(conversationId, status = null) {
  const query = { conversationId };
  if (status) query.status = status;
  return this.find(query).sort({ createdAt: -1 });
};

// Método estático para buscar acordos de um usuário
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

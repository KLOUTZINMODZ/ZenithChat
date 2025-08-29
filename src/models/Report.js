const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  proposalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcceptedProposal',
    index: true
  },
  type: {
    type: String,
    enum: ['harassment', 'fraud', 'inappropriate_behavior', 'service_not_delivered', 'poor_quality', 'payment_issues', 'other'],
    required: true,
    index: true
  },
  reason: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  // Dados completos de quem fez a denúncia
  reporter: {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
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
    totalOrders: Number,
    totalBoosts: Number,
    rating: Number,
    registeredAt: Date,
    lastLoginAt: Date,
    accountStatus: {
      type: String,
      enum: ['active', 'suspended', 'banned'],
      default: 'active'
    }
  },
  // Dados completos de quem foi denunciado
  reported: {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
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
    totalOrders: Number,
    totalBoosts: Number,
    rating: Number,
    registeredAt: Date,
    lastLoginAt: Date,
    accountStatus: {
      type: String,
      enum: ['active', 'suspended', 'banned'],
      default: 'active'
    },
    // Histórico de denúncias anteriores
    previousReportsCount: {
      type: Number,
      default: 0
    },
    previousSuspensions: Number
  },
  // Contexto do boosting/proposta
  contextData: {
    game: String,
    category: String,
    proposalValue: Number,
    startDate: Date,
    expectedEndDate: Date,
    actualProgress: String,
    messagesCount: Number,
    conversationDuration: Number // em minutos
  },
  // Status da denúncia
  status: {
    type: String,
    enum: ['pending', 'under_review', 'resolved', 'dismissed', 'escalated'],
    default: 'pending',
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
    index: true
  },
  // Evidências anexadas
  evidence: [{
    type: {
      type: String,
      enum: ['screenshot', 'message_log', 'video', 'document', 'other']
    },
    url: String,
    description: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Ações tomadas pelos moderadores
  moderationActions: [{
    actionType: {
      type: String,
      enum: ['warning', 'temporary_suspension', 'permanent_ban', 'refund_issued', 'dispute_resolved', 'no_action']
    },
    moderatorId: mongoose.Schema.Types.ObjectId,
    moderatorName: String,
    reason: String,
    actionDate: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],
  // Resolução da denúncia
  resolution: {
    outcome: {
      type: String,
      enum: ['reporter_favor', 'reported_favor', 'mutual_resolution', 'no_action_needed', 'insufficient_evidence']
    },
    resolvedBy: mongoose.Schema.Types.ObjectId,
    resolvedAt: Date,
    resolutionNotes: String,
    compensationIssued: {
      type: Boolean,
      default: false
    },
    compensationAmount: Number
  },
  // Comunicação interna
  internalNotes: [{
    author: mongoose.Schema.Types.ObjectId,
    authorName: String,
    note: String,
    createdAt: {
      type: Date,
      default: Date.now
    },
    visibility: {
      type: String,
      enum: ['internal', 'parties'],
      default: 'internal'
    }
  }],
  // Métricas para análise
  metrics: {
    responseTime: Number, // tempo em minutos até primeira resposta
    resolutionTime: Number, // tempo total em minutos até resolução
    escalationCount: {
      type: Number,
      default: 0
    },
    satisfactionRating: {
      type: Number,
      min: 1,
      max: 5
    }
  }
}, {
  timestamps: true
});

// Índices compostos para performance
reportSchema.index({ status: 1, priority: -1, createdAt: -1 });
reportSchema.index({ 'reporter.userid': 1, createdAt: -1 });
reportSchema.index({ 'reported.userid': 1, createdAt: -1 });
reportSchema.index({ type: 1, status: 1 });

// Método para escalar denúncia
reportSchema.methods.escalate = function(reason) {
  this.status = 'escalated';
  this.priority = this.priority === 'critical' ? 'critical' : 'high';
  this.metrics.escalationCount += 1;
  this.internalNotes.push({
    note: `Denúncia escalada: ${reason}`,
    visibility: 'internal'
  });
  return this.save();
};

// Método para resolver denúncia
reportSchema.methods.resolve = function(outcome, resolvedBy, notes, compensation = null) {
  this.status = 'resolved';
  this.resolution = {
    outcome,
    resolvedBy,
    resolvedAt: new Date(),
    resolutionNotes: notes,
    compensationIssued: !!compensation,
    compensationAmount: compensation
  };
  this.metrics.resolutionTime = Math.floor((new Date() - this.createdAt) / (1000 * 60));
  return this.save();
};

// Método para adicionar ação de moderação
reportSchema.methods.addModerationAction = function(actionType, moderatorId, moderatorName, reason, notes = '') {
  this.moderationActions.push({
    actionType,
    moderatorId,
    moderatorName,
    reason,
    notes
  });
  return this.save();
};

// Método para adicionar nota interna
reportSchema.methods.addInternalNote = function(authorId, authorName, note, visibility = 'internal') {
  this.internalNotes.push({
    author: authorId,
    authorName,
    note,
    visibility
  });
  return this.save();
};

module.exports = mongoose.model('Report', reportSchema);

const mongoose = require('mongoose');
const Conversation = require('./Conversation');
const AcceptedProposal = require('./AcceptedProposal');

/**
 * BoostingOrder - Snapshot persistente de pedidos de boosting
 * Similar ao modelo Purchase, mas para agreements de boosting
 * Criado quando um agreement é aceito e mantém os dados mesmo após conclusão/cancelamento
 */
const boostingOrderSchema = new mongoose.Schema({
  // ID único do pedido de boosting
  orderNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Referência ao Agreement original
  agreementId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agreement',
    required: true,
    index: true
  },

  // Referência ao BoostingRequest original
  boostingRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BoostingRequest',
    index: true
  },

  // Referência à conversa
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },

  // Participantes
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  boosterId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },

  // Dados do cliente (snapshot)
  clientData: {
    name: { type: String, required: true },
    email: String,
    avatar: String
  },

  // Dados do booster (snapshot)
  boosterData: {
    name: { type: String, required: true },
    email: String,
    avatar: String,
    rating: Number
  },

  // Status do pedido
  status: {
    type: String,
    enum: ['pending', 'active', 'completed', 'cancelled', 'expired', 'disputed'],
    required: true,
    default: 'pending',
    index: true
  },

  // Informações financeiras
  price: {
    type: Number,
    required: true
  },
  originalPrice: Number,
  currency: {
    type: String,
    default: 'BRL'
  },

  // Snapshot completo do serviço
  serviceSnapshot: {
    game: { type: String, required: true },
    category: String,
    currentRank: String,
    desiredRank: String,
    description: { type: String, required: true },
    estimatedTime: { type: String, required: true }
  },

  // Timestamps importantes
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  activatedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  expiredAt: Date,

  // Dados de conclusão
  completionDetails: {
    completedBy: mongoose.Schema.Types.ObjectId,
    completionNotes: String,
    finalRank: String
  },

  // Dados de cancelamento
  cancellationDetails: {
    cancelledBy: mongoose.Schema.Types.ObjectId,
    cancelReason: String,
    refundAmount: Number
  },

  // Avaliação (se houver)
  hasReview: {
    type: Boolean,
    default: false
  },
  reviewId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review'
  },

  // Metadados adicionais
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Índices compostos para queries eficientes
boostingOrderSchema.index({ clientId: 1, status: 1, createdAt: -1 });
boostingOrderSchema.index({ boosterId: 1, status: 1, createdAt: -1 });
boostingOrderSchema.index({ status: 1, createdAt: -1 });
boostingOrderSchema.index({ agreementId: 1 });

// Método estático para criar a partir de um Agreement
boostingOrderSchema.statics.createFromAgreement = async function(agreement) {
  // Verificar se já existe
  const existing = await this.findOne({ agreementId: agreement._id });
  if (existing) {
    return existing;
  }

  const orderNumber = `BO_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  // Normalizar IDs para ObjectId válidos
  const normalizeObjectId = (value) => {
    if (!value) return null;
    const str = value.toString();
    return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
  };

  const resolveParticipantId = async (role) => {
    const participant = agreement.parties?.[role];

    const potentialValues = [
      participant?.userid,
      participant?._id,
      participant?.metadata?.userId,
      participant?.metadata?._id,
      participant?.metadata?.legacyUserId,
      participant?.metadata?.legacyId,
      participant?.metadata?.originalUserId
    ];

    for (const value of potentialValues) {
      const normalized = normalizeObjectId(value);
      if (normalized) return normalized;
    }

    if (agreement.conversationId) {
      const conversation = await Conversation.findById(agreement.conversationId).select(`${role}.userid`);
      const conversationId = conversation?.[role]?.userid;
      const normalized = normalizeObjectId(conversationId);
      if (normalized) return normalized;
    }

    if (agreement.acceptedProposalId) {
      const acceptedProposal = await AcceptedProposal.findById(agreement.acceptedProposalId).select(`${role}.userid`);
      const proposalId = acceptedProposal?.[role]?.userid;
      const normalized = normalizeObjectId(proposalId);
      if (normalized) return normalized;
    }

    return null;
  };

  const [normalizedClientId, normalizedBoosterId] = await Promise.all([
    resolveParticipantId('client'),
    resolveParticipantId('booster')
  ]);

  if (!normalizedClientId || !normalizedBoosterId) {
    throw new Error(`Invalid clientId/boosterId for BoostingOrder: client=${agreement.parties?.client?.userid}, booster=${agreement.parties?.booster?.userid}`);
  }

  const boostingOrder = new this({
    orderNumber,
    agreementId: agreement._id,
    boostingRequestId: agreement.boostingRequestId,
    conversationId: agreement.conversationId,
    clientId: normalizedClientId,
    boosterId: normalizedBoosterId,
    clientData: {
      name: agreement.parties.client.name,
      email: agreement.parties.client.email,
      avatar: agreement.parties.client.avatar
    },
    boosterData: {
      name: agreement.parties.booster.name,
      email: agreement.parties.booster.email,
      avatar: agreement.parties.booster.avatar,
      rating: agreement.parties.booster.rating
    },
    status: agreement.status,
    price: agreement.proposalSnapshot?.price || agreement.price || 0,
    originalPrice: agreement.renegotiationData?.originalPrice,
    serviceSnapshot: {
      game: agreement.proposalSnapshot.game,
      category: agreement.proposalSnapshot.category,
      currentRank: agreement.proposalSnapshot.currentRank,
      desiredRank: agreement.proposalSnapshot.desiredRank,
      description: agreement.proposalSnapshot.description,
      estimatedTime: agreement.proposalSnapshot.estimatedTime
    },
    createdAt: agreement.createdAt,
    activatedAt: agreement.activatedAt,
    completedAt: agreement.completedAt,
    cancelledAt: agreement.cancelledAt,
    expiredAt: agreement.expiredAt
  });

  return boostingOrder.save();
};

// Método para atualizar status a partir do Agreement
boostingOrderSchema.methods.syncFromAgreement = async function(agreement) {
  this.status = agreement.status;
  this.activatedAt = agreement.activatedAt;
  this.completedAt = agreement.completedAt;
  this.cancelledAt = agreement.cancelledAt;
  this.expiredAt = agreement.expiredAt;

  // Atualizar preço se houve renegociação
  if (agreement.proposalSnapshot?.price) {
    this.price = agreement.proposalSnapshot.price;
  }

  // Atualizar dados de conclusão
  if (agreement.status === 'completed' && agreement.actionHistory) {
    const completionAction = agreement.actionHistory.find(a => a.action === 'completed');
    if (completionAction) {
      this.completionDetails = {
        completedBy: completionAction.performedBy,
        completionNotes: completionAction.details?.get?.('notes') || completionAction.details?.notes,
        finalRank: completionAction.details?.get?.('finalRank') || completionAction.details?.finalRank
      };
    }
  }

  // Atualizar dados de cancelamento
  if (agreement.status === 'cancelled' && agreement.actionHistory) {
    const cancelAction = agreement.actionHistory.find(a => a.action === 'cancelled');
    if (cancelAction) {
      this.cancellationDetails = {
        cancelledBy: cancelAction.performedBy,
        cancelReason: cancelAction.details?.get?.('reason') || cancelAction.details?.reason,
        refundAmount: cancelAction.details?.get?.('refundAmount') || cancelAction.details?.refundAmount
      };
    }
  }

  return this.save();
};

module.exports = mongoose.model('BoostingOrder', boostingOrderSchema);

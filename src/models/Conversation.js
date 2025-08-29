const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  type: {
    type: String,
    enum: ['direct', 'group', 'marketplace'],
    default: 'direct'
  },
  name: {
    type: String,
    required: function() {
      return this.type === 'group';
    }
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastMessageAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  unreadCount: {
    type: Map,
    of: Number,
    default: new Map()
  },
  marketplaceItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MarketItem'
  },
  proposal: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isReported: {
    type: Boolean,
    default: false,
    index: true
  },
  reportedAt: {
    type: Date
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Status específico para chats de boosting
  boostingStatus: {
    type: String,
    enum: ['pending', 'active', 'completed', 'cancelled', 'disputed'],
    default: null,
    index: true
  },
  // Indica se o chat está finalizado (não permite mais mensagens)
  isFinalized: {
    type: Boolean,
    default: false,
    index: true
  },
  finalizedAt: {
    type: Date,
    index: true
  },
  finalizedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Referência para a proposta aceita (se aplicável)
  acceptedProposal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcceptedProposal'
  },
  // Campos para Chat Temporário
  isTemporary: {
    type: Boolean,
    default: false,
    index: true
  },
  expiresAt: {
    type: Date,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'expired', 'active'],
    default: 'active',
    index: true
  },
  // Campos específicos para identificação de papéis
  client: {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: String,
    email: String,
    avatar: String,
    isVerified: Boolean,
    totalOrders: Number,
    rating: Number,
    registeredAt: Date
  },
  booster: {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: String,
    email: String,
    avatar: String,
    isVerified: Boolean,
    rating: Number,
    totalBoosts: Number,
    completedBoosts: Number,
    specializations: [String],
    registeredAt: Date
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes
conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ 'participants': 1, 'lastMessageAt': -1 });

// Virtual for participant count
conversationSchema.virtual('participantCount').get(function() {
  return this.participants.length;
});

// Method to check if user is participant
conversationSchema.methods.isParticipant = function(userId) {
  return this.participants.some(p => {
    // Handle both populated (User object) and non-populated (ObjectId) participants
    const participantId = p._id ? p._id.toString() : p.toString();
    return participantId === userId.toString();
  });
};

// Method to add participant
conversationSchema.methods.addParticipant = function(userId) {
  if (!this.isParticipant(userId)) {
    this.participants.push(userId);
  }
  return this.save();
};

// Method to remove participant
conversationSchema.methods.removeParticipant = function(userId) {
  this.participants = this.participants.filter(p => p.toString() !== userId.toString());
  return this.save();
};

// Method to reset unread count for a user
conversationSchema.methods.resetUnreadCount = function(userId) {
  this.unreadCount.set(userId.toString(), 0);
  return this.save();
};

// Method to increment unread count for all participants except sender
conversationSchema.methods.incrementUnreadCount = function(senderId) {
  this.participants.forEach(participant => {
    if (participant.toString() !== senderId.toString()) {
      const currentCount = this.unreadCount.get(participant.toString()) || 0;
      this.unreadCount.set(participant.toString(), currentCount + 1);
    }
  });
  return this.save();
};

// Method to finalize conversation (no more messages allowed)
conversationSchema.methods.finalize = function(userId) {
  this.isFinalized = true;
  this.finalizedAt = new Date();
  this.finalizedBy = userId;
  this.isActive = false;
  return this.save();
};

// Method to check if conversation allows new messages
conversationSchema.methods.canReceiveMessages = function() {
  return this.isActive && !this.isFinalized && this.status !== 'expired';
};

// Method to check if temporary chat is expired
conversationSchema.methods.isExpired = function() {
  return this.isTemporary && this.expiresAt && new Date() > this.expiresAt;
};

// Method to accept temporary chat (convert to permanent)
conversationSchema.methods.acceptTemporaryChat = function() {
  if (this.isTemporary && this.status === 'pending') {
    this.isTemporary = false;
    this.status = 'active';
    this.expiresAt = undefined;
    return this.save();
  }
  throw new Error('Chat não é temporário ou já foi processado');
};

// Method to expire temporary chat
conversationSchema.methods.expireTemporaryChat = function() {
  if (this.isTemporary) {
    this.status = 'expired';
    this.isActive = false;
    return this.save();
  }
  throw new Error('Chat não é temporário');
};

// Static method to find or create conversation
conversationSchema.statics.findOrCreate = async function(participantIds, metadata = {}) {
  // Sort participant IDs to ensure consistent lookup
  const sortedIds = participantIds.sort();
  
  let conversation = await this.findOne({
    participants: { $all: sortedIds, $size: sortedIds.length },
    type: sortedIds.length === 2 ? 'direct' : 'group'
  });

  if (!conversation) {
    conversation = await this.create({
      participants: sortedIds,
      type: sortedIds.length === 2 ? 'direct' : 'group',
      metadata
    });
  }

  return conversation;
};

module.exports = mongoose.model('Conversation', conversationSchema);

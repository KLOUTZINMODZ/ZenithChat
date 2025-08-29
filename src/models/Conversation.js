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

  boostingStatus: {
    type: String,
    enum: ['pending', 'active', 'completed', 'cancelled', 'disputed'],
    default: null,
    index: true
  },

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

  acceptedProposal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcceptedProposal'
  },

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


conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ 'participants': 1, 'lastMessageAt': -1 });


conversationSchema.virtual('participantCount').get(function() {
  return this.participants.length;
});


conversationSchema.methods.isParticipant = function(userId) {
  return this.participants.some(p => {

    const participantId = p._id ? p._id.toString() : p.toString();
    return participantId === userId.toString();
  });
};


conversationSchema.methods.addParticipant = function(userId) {
  if (!this.isParticipant(userId)) {
    this.participants.push(userId);
  }
  return this.save();
};


conversationSchema.methods.removeParticipant = function(userId) {
  this.participants = this.participants.filter(p => p.toString() !== userId.toString());
  return this.save();
};


conversationSchema.methods.resetUnreadCount = function(userId) {
  this.unreadCount.set(userId.toString(), 0);
  return this.save();
};


conversationSchema.methods.incrementUnreadCount = function(senderId) {
  this.participants.forEach(participant => {
    if (participant.toString() !== senderId.toString()) {
      const currentCount = this.unreadCount.get(participant.toString()) || 0;
      this.unreadCount.set(participant.toString(), currentCount + 1);
    }
  });
  return this.save();
};


conversationSchema.methods.finalize = function(userId) {
  this.isFinalized = true;
  this.finalizedAt = new Date();
  this.finalizedBy = userId;
  this.isActive = false;
  return this.save();
};


conversationSchema.methods.canReceiveMessages = function() {
  return this.isActive && !this.isFinalized && this.status !== 'expired';
};


conversationSchema.methods.isExpired = function() {
  return this.isTemporary && this.expiresAt && new Date() > this.expiresAt;
};


conversationSchema.methods.acceptTemporaryChat = function() {
  if (this.isTemporary && this.status === 'pending') {
    this.isTemporary = false;
    this.status = 'active';
    this.expiresAt = undefined;
    return this.save();
  }
  throw new Error('Chat não é temporário ou já foi processado');
};


conversationSchema.methods.expireTemporaryChat = function() {
  if (this.isTemporary) {
    this.status = 'expired';
    this.isActive = false;
    return this.save();
  }
  throw new Error('Chat não é temporário');
};


conversationSchema.statics.findOrCreate = async function(participantIds, metadata = {}) {

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

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.Mixed, // Allow 'system' string or ObjectId
    required: true
  },
  content: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'system'],
    default: 'text'
  },
  messageId: {
    type: String,
    unique: true,
    sparse: true // Allow null for existing messages
  },
  systemType: {
    type: String,
    enum: ['temporary_created', 'temporary_expired', 'proposal_accepted', 'proposal_rejected', 'delivery_confirmed', 'cancellation', 'renegotiation', 'report', 'unreport'],
    required: function() { return this.type === 'system'; }
  },
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'file']
    },
    url: String,
    filename: String,
    size: Number
  }],
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  deliveredTo: [{
    user: {
      type: mongoose.Schema.Types.Mixed, // Allow ObjectId or string
    },
    deliveredAt: {
      type: Date,
      default: Date.now
    }
  }],
  editedAt: Date,
  deletedAt: Date,
  expiresAt: Date,
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});


messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ 'readBy.user': 1 });
messageSchema.index({ messageId: 1 });
messageSchema.index({ type: 1, systemType: 1 });


messageSchema.virtual('isReadBy').get(function() {
  return (userId) => {
    return this.readBy.some(read => read.user.toString() === userId.toString());
  };
});


messageSchema.methods.markAsRead = function(userId) {
  if (!this.isReadBy(userId)) {
    this.readBy.push({
      user: userId,
      readAt: new Date()
    });
  }
  return this.save();
};


messageSchema.methods.softDelete = function() {
  this.deletedAt = new Date();
  this.content = '[Message deleted]';
  return this.save();
};

module.exports = mongoose.model('Message', messageSchema);

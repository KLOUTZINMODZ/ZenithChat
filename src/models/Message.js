const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  content: {
    type: String,
    required: function() {
      return this.type === 'text';
    }
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'video', 'system'],
    default: 'text'
  },
  attachments: [{
    url: String,
    thumbUrl: String,
    urlJpeg: String,
    thumbUrlJpeg: String,
    name: String,
    size: Number,
    mimeType: String,
    originalMimeType: String,
    width: Number,
    height: Number
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
  editedAt: Date,
  deletedAt: Date,
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
// Optimize unread lookups combined with conversation and sender filters
messageSchema.index({ conversation: 1, 'readBy.user': 1, sender: 1, createdAt: -1 });

messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 15 });


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

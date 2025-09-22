const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['customer', 'seller', 'admin', 'bot'], default: 'customer' },
}, { _id: false });

const supportThreadSchema = new mongoose.Schema({
  type: { type: String, enum: ['ticket', 'report'], default: 'ticket', index: true },
  status: { type: String, enum: ['open', 'bot', 'waiting_user', 'human', 'pending', 'closed'], default: 'bot', index: true },
  participants: [participantSchema],
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  linked: {
    purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', index: true },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', index: true },
    kind: { type: String, enum: ['purchase', 'conversation', 'report', 'other'], default: 'purchase' }
  },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  unreadCount: { type: Map, of: Number, default: new Map() },
  triage: { type: Map, of: mongoose.Schema.Types.Mixed },
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

supportThreadSchema.index({ 'linked.purchaseId': 1 }, { sparse: true });
supportThreadSchema.index({ 'linked.reportId': 1 }, { sparse: true });
supportThreadSchema.index({ status: 1, updatedAt: -1 });

supportThreadSchema.methods.isParticipant = function(userId) {
  try {
    const uid = userId?.toString?.() || String(userId);
    return this.participants.some(p => (p.userId?.toString?.() || String(p.userId)) === uid);
  } catch (_) { return false; }
};

supportThreadSchema.methods.incrementUnreadForOthers = function(senderId) {
  try {
    const s = senderId?.toString?.() || String(senderId);
    this.participants.forEach(p => {
      const pid = p.userId?.toString?.() || String(p.userId);
      if (pid !== s) {
        const current = this.unreadCount.get(pid) || 0;
        this.unreadCount.set(pid, current + 1);
      }
    });
  } catch (_) {}
};

module.exports = mongoose.model('SupportThread', supportThreadSchema);

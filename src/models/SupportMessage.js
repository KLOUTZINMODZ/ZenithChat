const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema({
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportThread', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  role: { type: String, enum: ['customer', 'seller', 'admin', 'bot', 'system'], default: 'admin' },
  type: { type: String, enum: ['text', 'bot', 'system', 'internal'], default: 'text' },
  visibility: { type: String, enum: ['public', 'internal'], default: 'public', index: true },
  body: { type: String, default: '' },
  attachments: [{ url: String, type: { type: String, enum: ['image', 'file'] }, name: String }],
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

supportMessageSchema.index({ threadId: 1, createdAt: -1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);

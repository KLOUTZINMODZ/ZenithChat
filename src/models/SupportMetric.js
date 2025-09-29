const mongoose = require('mongoose');

const supportMetricSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, index: true },
  type: { type: String, enum: ['analyze', 'suggest', 'feedback'], required: true },
  intent: { type: String, default: null, index: true },
  confidence: { type: Number, default: null },
  entities: { type: mongoose.Schema.Types.Mixed, default: null },
  actions: [{ type: String }],
  text: { type: String, default: '' },
  locale: { type: String, default: 'pt-BR' },
  meta: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

supportMetricSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SupportMetric', supportMetricSchema);

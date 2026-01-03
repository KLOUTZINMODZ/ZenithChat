const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  endpoint: {
    type: String,
    required: true,
    unique: true
  },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  userAgent: {
    type: String,
    default: null
  },
  active: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

pushSubscriptionSchema.index({ userId: 1, active: 1 });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);

const mongoose = require('mongoose');

const mediatorSchema = new mongoose.Schema({
  eventType: { type: String, enum: ['fee', 'withdraw', 'release', 'adjustment'], required: true, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'BRL' },

  operationId: { type: String, required: true, unique: true, index: true },
  source: { type: String, enum: ['ZenithChatApi', 'ZenithAPI', 'APIAdministrativa', 'Asaas'], required: true },
  occurredAt: { type: Date, required: true, index: true },

  reference: {
    purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase' },
    orderId: { type: mongoose.Schema.Types.ObjectId },
    walletLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletLedger' },
    transactionId: { type: mongoose.Schema.Types.ObjectId },
    asaasTransferId: { type: String }
  },

  metadata: { type: Object },
  description: { type: String }
}, { timestamps: true, collection: 'mediator' });

module.exports = mongoose.model('Mediator', mediatorSchema);

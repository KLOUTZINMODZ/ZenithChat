const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['deposit', 'withdraw', 'fee_transfer'], required: true },


  amountGross: { type: Number, required: true },
  feePercent: { type: Number, default: 0 },
  feeAmount: { type: Number, default: 0 },
  amountNet: { type: Number, required: true },

  currency: { type: String, default: 'BRL' },


  asaasPaymentId: { type: String, index: true },
  asaasTransferId: { type: String, index: true },
  externalReference: { type: String, index: true },

  idempotencyKey: { type: String, index: true },


  withdrawPixKey: { type: String },
  withdrawPixKeyType: { type: String },


  status: { 
    type: String, 
    enum: [
      'pending',
      'paid',
      'credited',
      'fee_transfer_pending',
      'fee_transfer_completed',
      'withdraw_pending',
      'withdraw_completed',
      'failed',
      'cancelled'
    ],
    default: 'pending',
    index: true
  },

  logs: [{
    at: { type: Date, default: Date.now },
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    message: { type: String },
    data: { type: Object }
  }]
}, { timestamps: true });


walletTransactionSchema.index(
  { userId: 1, type: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true, $type: 'string' } } }
);

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);

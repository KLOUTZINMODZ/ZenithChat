const mongoose = require('mongoose');



const walletLedgerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  txId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction', index: true },


  direction: { type: String, enum: ['debit', 'credit'], required: true },
  reason: { type: String, enum: [
    'withdraw_reserve',
    'withdraw_refund',
    'withdraw_settle',
    'deposit_credit',
    'deposit_revert',
    'adjustment',
    'purchase_reserve',
    'purchase_refund',
    'purchase_release'
  ], required: true },

  amount: { type: Number, required: true },
  currency: { type: String, default: 'BRL' },


  operationId: { type: String, required: true, unique: true, index: true },


  balanceBefore: { type: Number },
  balanceAfter: { type: Number },

  metadata: { type: Object }
}, { timestamps: true });

module.exports = mongoose.model('WalletLedger', walletLedgerSchema);

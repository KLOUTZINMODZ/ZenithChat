const mongoose = require('mongoose');



const walletLedgerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  txId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction', index: true },


  direction: { type: String, enum: ['debit', 'credit'], required: true },
  reason: { type: String, enum: [
    'withdraw_reserve',
    'withdraw_refund',
    'withdraw_settle',
    'withdraw_fee',            // Taxa de saque creditada ao mediador
    'deposit_credit',
    'deposit_revert',
    'adjustment',
    'purchase_reserve',
    'purchase_refund',
    'purchase_cancel_refund',
    'purchase_release',
    'purchase_fee',
    'purchase_settle',
    'boosting_escrow',         // NOVO: Cliente debitado ao aceitar proposta
    'boosting_escrow_release',  // NOVO: Escrow liberado ao confirmar entrega
    'boosting_payment',         // NOVO: Fluxo legado (sem escrow)
    'boosting_release',
    'boosting_fee'
  ], required: true },

  amount: { type: Number, required: true },
  currency: { type: String, default: 'BRL' },


  operationId: { type: String, required: true, unique: true, index: true },


  balanceBefore: { type: Number },
  balanceAfter: { type: Number },

  metadata: { type: Object }
}, { timestamps: true });

module.exports = mongoose.model('WalletLedger', walletLedgerSchema);

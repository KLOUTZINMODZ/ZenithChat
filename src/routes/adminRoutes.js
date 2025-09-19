const express = require('express');
const mongoose = require('mongoose');
const MarketItem = require('../models/MarketItem');
const User = require('../models/User');
const logger = require('../utils/logger');

const router = express.Router();
const WalletTransaction = require('../models/WalletTransaction');
const WalletLedger = require('../models/WalletLedger');
const AsaasService = require('../services/AsaasService');

function round2(v) { return Math.round(Number(v) * 100) / 100; }

async function findMediatorUser() {
  const id = process.env.MEDIATOR_USER_ID ? String(process.env.MEDIATOR_USER_ID) : null;
  const email = process.env.MEDIATOR_EMAIL ? String(process.env.MEDIATOR_EMAIL).trim().toLowerCase() : null;
  let u = null;
  if (id && mongoose.Types.ObjectId.isValid(id)) {
    try { u = await User.findById(id); } catch (_) {}
  }
  if (!u && email) {
    try { u = await User.findOne({ email }); } catch (_) {}
  }
  if (!u) {
    try { u = await User.findOne({ role: 'admin' }); } catch (_) {}
  }
  return u;
}

function safeId(v) {
  try {
    if (!v) return null;
    if (mongoose.Types.ObjectId.isValid(v)) return String(v);
    if (typeof v === 'string' && mongoose.Types.ObjectId.isValid(v)) return v;
    if (typeof v === 'object') {
      if (v._id && mongoose.Types.ObjectId.isValid(v._id)) return String(v._id);
      if (v.$oid && typeof v.$oid === 'string' && mongoose.Types.ObjectId.isValid(v.$oid)) return v.$oid;
      if (typeof v.toHexString === 'function') return v.toHexString();
    }
  } catch (_) {}
  return null;
}

function requireAdminKey(req, res, next) {
  const provided = req.headers['x-admin-key'] || req.headers['x-api-key'];
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return res.status(500).json({ success: false, message: 'ADMIN_API_KEY não configurada no servidor' });
  }
  if (!provided || provided !== expected) {
    return res.status(403).json({ success: false, message: 'Acesso negado' });
  }
  return next();
}

// PATCH /api/admin/market-items/:itemId/seller
// Body: { sellerUserId: string }
router.patch('/market-items/:itemId/seller', requireAdminKey, async (req, res) => {
  try {
    const itemId = safeId(req.params.itemId);
    const sellerUserId = safeId(req.body?.sellerUserId);
    if (!itemId) return res.status(400).json({ success: false, message: 'itemId inválido' });
    if (!sellerUserId) return res.status(400).json({ success: false, message: 'sellerUserId inválido' });

    const seller = await User.findById(sellerUserId);
    if (!seller) return res.status(404).json({ success: false, message: 'Usuário vendedor não encontrado' });

    const item = await MarketItem.findById(itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item não encontrado' });

    item.userId = seller._id;
    try { item.sellerId = seller._id; } catch (_) {}
    await item.save();

    try { logger.info('[ADMIN] MarketItem seller set', { itemId, sellerUserId }); } catch (_) {}

    return res.json({ success: true, message: 'Vendedor definido para o item', data: { itemId, sellerUserId } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao definir vendedor do item', error: error.message });
  }
});

// GET /api/admin/mediator/summary
router.get('/mediator/summary', requireAdminKey, async (req, res) => {
  try {
    const mediator = await findMediatorUser();
    if (!mediator) return res.status(404).json({ success: false, message: 'Usuário mediador não encontrado' });

    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(now); endOfDay.setHours(23,59,59,999);

    // feesToday and totalFees for mediator from WalletLedger
    const [feesTodayAgg, totalFeesAgg] = await Promise.all([
      WalletLedger.aggregate([
        { $match: { userId: mediator._id, reason: 'purchase_fee', createdAt: { $gte: startOfDay, $lte: endOfDay } } },
        { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: ['$amount', 0] } } } } }
      ]),
      WalletLedger.aggregate([
        { $match: { userId: mediator._id, reason: 'purchase_fee' } },
        { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: ['$amount', 0] } } } } }
      ])
    ]);
    const feesToday = feesTodayAgg?.[0]?.total || 0;
    const totalFees = totalFeesAgg?.[0]?.total || 0;

    // pendingWithdrawals for mediator from WalletTransaction
    const pendingAgg = await WalletTransaction.aggregate([
      { $match: { userId: mediator._id, type: 'withdraw', status: { $in: ['withdraw_pending', 'processing'] } } },
      { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: ['$amountNet', { $ifNull: ['$amountGross', 0] }] } } } } }
    ]);
    const pendingWithdrawals = pendingAgg?.[0]?.total || 0;

    // volumeToday (gross) from purchase releases across the platform (metadata.price on WalletLedger)
    const volumeAgg = await WalletLedger.aggregate([
      { $match: { reason: 'purchase_release', createdAt: { $gte: startOfDay, $lte: endOfDay } } },
      { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: ['$metadata.price', 0] } } } } }
    ]);
    const volumeToday = volumeAgg?.[0]?.total || 0;

    // transactionsByType for last 30 days from WalletTransaction (deposit/withdraw)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const txTypeAgg = await WalletTransaction.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$type', count: { $sum: 1 }, amount: { $sum: { $toDouble: { $ifNull: ['$amountGross', { $ifNull: ['$amountNet', 0] }] } } } } },
      { $project: { _id: 0, type: '$_id', count: 1, amount: 1 } }
    ]);
    const transactionsByType = {};
    for (const it of txTypeAgg || []) transactionsByType[String(it.type || 'unknown')] = { count: it.count || 0, amount: it.amount || 0 };

    return res.json({
      success: true,
      data: {
        totalBalance: round2(mediator.walletBalance || 0),
        volumeToday: round2(volumeToday),
        pendingWithdrawals: round2(pendingWithdrawals),
        transactionsByType,
        feesToday: round2(feesToday),
        totalFees: round2(totalFees),
        range: { from: startOfDay, to: endOfDay }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao obter resumo do mediador', error: error.message });
  }
});

// POST /api/admin/mediator/credit-fee
// Body: { amount: number, purchaseId?: string, itemId?: string, sellerId?: string, price?: number, feePercent?: number, operationId?: string }
router.post('/mediator/credit-fee', requireAdminKey, async (req, res) => {
  try {
    const { amount, purchaseId, itemId, sellerId, price, feePercent, operationId } = req.body || {};
    const feeAmount = round2(Number(amount || 0));
    if (!(feeAmount > 0)) {
      return res.status(400).json({ success: false, message: 'amount inválido' });
    }
    const mediator = await findMediatorUser();
    if (!mediator) return res.status(404).json({ success: false, message: 'Usuário mediador não encontrado' });

    const opId = String(operationId || (purchaseId ? `purchase_fee:${purchaseId}` : `purchase_fee:${Date.now()}`));

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const before = round2(mediator.walletBalance || 0);
      const after = round2(before + feeAmount);
      mediator.walletBalance = after;
      await mediator.save({ session });

      await WalletLedger.create([{
        userId: mediator._id,
        txId: null,
        direction: 'credit',
        reason: 'purchase_fee',
        amount: feeAmount,
        operationId: opId,
        balanceBefore: before,
        balanceAfter: after,
        metadata: {
          source: 'purchase',
          purchaseId: purchaseId || null,
          itemId: itemId || null,
          sellerId: sellerId || null,
          price: price != null ? Number(price) : undefined,
          feeAmount: feeAmount,
          feePercent: feePercent != null ? Number(feePercent) : undefined
        }
      }], { session });

      await session.commitTransaction();
      session.endSession();
      try { logger?.info?.('[ADMIN] Mediator fee credited', { opId, amount: feeAmount }); } catch (_) {}
      return res.json({ success: true, data: { balance: after, credited: feeAmount, operationId: opId } });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      if (err && err.code === 11000) {
        return res.status(409).json({ success: false, message: 'Operação já aplicada (idempotente)', error: 'DUPLICATE_OPERATION', operationId: opId });
      }
      throw err;
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao creditar taxa do mediador', error: error.message });
  }
});

// POST /api/admin/mediator/withdraw
// Body: { amount?: number, pixKey?: string, pixKeyType?: 'CPF'|'CNPJ'|'PHONE', description?: string, idempotencyKey?: string }
router.post('/mediator/withdraw', requireAdminKey, async (req, res) => {
  const { amount, pixKey, pixKeyType, description, idempotencyKey } = req.body || {};
  try {
    const mediator = await findMediatorUser();
    if (!mediator) return res.status(404).json({ success: false, message: 'Usuário mediador não encontrado' });

    const keyType = (pixKeyType || process.env.MEDIATOR_PIX_KEY_TYPE || 'CPF');
    const key = (pixKey || process.env.MEDIATOR_PIX_KEY);
    if (!key) return res.status(400).json({ success: false, message: 'Chave Pix do mediador não configurada' });

    const available = round2(mediator.walletBalance || 0);
    const value = round2(amount != null ? Number(amount) : available);
    if (!(value > 0)) return res.status(400).json({ success: false, message: 'Sem saldo para saque' });
    if (value > available) return res.status(400).json({ success: false, message: 'Saldo insuficiente para o valor requisitado' });

    const session = await mongoose.startSession();
    session.startTransaction();
    let tx;
    try {
      const before = round2(mediator.walletBalance || 0);
      const after = round2(before - value);
      mediator.walletBalance = after;
      await mediator.save({ session });

      tx = await WalletTransaction.create([{
        userId: mediator._id,
        type: 'withdraw',
        amountGross: value,
        feePercent: 0,
        feeAmount: 0,
        amountNet: value,
        status: 'withdraw_pending',
        withdrawPixKey: key,
        withdrawPixKeyType: keyType,
        idempotencyKey: idempotencyKey || undefined,
        logs: [{ level: 'info', message: 'Withdraw initiated (admin)', data: { value } }]
      }], { session });
      tx = tx && tx[0];

      await WalletLedger.create([{
        userId: mediator._id,
        txId: tx._id,
        direction: 'debit',
        reason: 'withdraw_reserve',
        amount: value,
        operationId: `reserve:${tx._id.toString()}`,
        balanceBefore: before,
        balanceAfter: after,
        metadata: { source: 'withdraw', status: 'withdraw_pending' }
      }], { session });

      await session.commitTransaction();
      session.endSession();
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      throw e;
    }

    // Create Asaas transfer outside the DB transaction
    let transfer;
    try {
      transfer = await AsaasService.createPixTransferWithRetry({
        value,
        pixAddressKey: key,
        pixAddressKeyType: keyType,
        description: description || `Saque mediador tx ${tx._id.toString()}`,
        externalReference: `mediator_withdraw:${tx._id.toString()}`
      }, { attempts: 2, delayMs: 800, timeoutMs: 10000 });
    } catch (err) {
      // Refund ledger and mark failed
      try {
        const s2 = await mongoose.startSession();
        s2.startTransaction();
        const latest = await WalletTransaction.findById(tx._id).session(s2);
        if (latest && latest.status === 'withdraw_pending') {
          const freshUser = await User.findById(mediator._id).session(s2);
          const before = round2(freshUser.walletBalance || 0);
          const after = round2(before + value);
          freshUser.walletBalance = after;
          await freshUser.save({ session: s2 });
          await WalletLedger.create([{
            userId: mediator._id,
            txId: tx._id,
            direction: 'credit',
            reason: 'withdraw_refund',
            amount: value,
            operationId: `refund:${tx._id.toString()}`,
            balanceBefore: before,
            balanceAfter: after,
            metadata: { source: 'withdraw', status: 'failed' }
          }], { session: s2 });
          latest.status = 'failed';
          latest.logs.push({ level: 'error', message: 'Asaas transfer failed', data: { error: err?.message } });
          await latest.save({ session: s2 });
        }
        await s2.commitTransaction();
        s2.endSession();
      } catch (_) {}
      return res.status(502).json({ success: false, message: 'Falha ao criar transferência Pix na Asaas', error: err?.message });
    }

    try {
      await WalletTransaction.updateOne({ _id: tx._id }, { $set: { asaasTransferId: transfer.id }, $push: { logs: { level: 'info', message: 'Asaas transfer created', data: { transferId: transfer.id } } } });
    } catch (_) {}

    return res.json({ success: true, data: { transactionId: tx._id.toString(), transferId: transfer.id, value } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao iniciar saque do mediador', error: error.message });
  }
});

module.exports = router;

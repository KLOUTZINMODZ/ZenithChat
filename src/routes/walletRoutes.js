const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');
const AsaasService = require('../services/AsaasService');
const WalletTransaction = require('../models/WalletTransaction');
const User = require('../models/User');
const WalletLedger = require('../models/WalletLedger');
const Mediator = require('../models/Mediator');
const mongoose = require('mongoose');
const crypto = require('crypto');

const FEE_PERCENT = 0;
const WITHDRAW_FEE = 5.00; // Taxa fixa de saque em R$
const MAX_WITHDRAW_AMOUNT = 1000000.00; // Limite máximo de saque: R$ 1.000.000,00
const MAX_FAILED_ATTEMPTS = 5; // Máximo de tentativas falhas por hora
const BLOCK_DURATION_MS = 60 * 60 * 1000; // 1 hora em milissegundos

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}


async function applyLedgerCreditDeposit(app, userId, tx) {
  const opId = `deposit:${tx._id.toString()}`;
  return runWithTransactionOrFallback(async (session) => {
    const existing = await WalletLedger.findOne({ operationId: opId }).session(session);
    const u = await User.findById(userId).session(session);
    if (existing) {
      return { applied: false, balance: u?.walletBalance ?? null };
    }
    const before = round2(u?.walletBalance || 0);
    const amount = Number(tx.amountNet);
    u.walletBalance = round2(before + amount);
    await u.save({ session });
    await WalletLedger.create([{
      userId,
      txId: tx._id,
      direction: 'credit',
      reason: 'deposit_credit',
      amount,
      operationId: opId,
      balanceBefore: before,
      balanceAfter: u.walletBalance,
      metadata: { source: 'deposit', status: 'credited' }
    }], { session });
    await sendBalanceUpdateEvent(app, userId, {
      userId: userId.toString(),
      transactionId: tx._id.toString(),
      status: tx.status,
      balance: u.walletBalance,
      amountGross: tx.amountGross,
      feeAmount: tx.feeAmount,
      amountNet: tx.amountNet,
      timestamp: new Date().toISOString()
    });
    return { applied: true, balance: u.walletBalance };
  });
}


function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfTomorrow() {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}


async function expireStalePendingWithdrawsForUser(app, userId) {
  try {
    const cutoff = startOfToday();
    const stale = await WalletTransaction.find({
      userId,
      type: 'withdraw',
      status: { $in: ['withdraw_pending', 'processing'] },
      createdAt: { $lt: cutoff }
    }).limit(50);
    for (const tx of stale) {

      await applyLedgerCreditRefund(app, tx.userId, tx).catch(() => {});
      tx.status = 'failed';
      tx.logs.push({ level: 'error', message: 'Withdraw expired (previous day)', at: new Date().toISOString() });
      await tx.save();
    }
  } catch (_) {}
}


async function runWithTransactionOrFallback(executor) {
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const res = await executor(session);
    await session.commitTransaction();
    session.endSession();
    return res;
  } catch (err) {
    if (session) {
      try { await session.abortTransaction(); } catch (_) {}
      session.endSession();
    }

    return executor(null);
  }
}


async function applyLedgerDebitReserve(app, userId, tx, amount) {
  const opId = `reserve:${tx._id.toString()}`;
  return runWithTransactionOrFallback(async (session) => {
    const existing = await WalletLedger.findOne({ operationId: opId }).session(session);
    if (existing) {
      const u = await User.findById(userId).session(session);
      return { applied: false, balance: u?.walletBalance ?? null };
    }
    const u = await User.findById(userId).session(session);
    if (!u || Number(u.walletBalance) < Number(amount)) {
      throw new Error('INSUFFICIENT_BALANCE');
    }
    const before = round2(u.walletBalance || 0);
    u.walletBalance = round2(before - Number(amount));
    await u.save({ session });
    await WalletLedger.create([{
      userId,
      txId: tx._id,
      direction: 'debit',
      reason: 'withdraw_reserve',
      amount: Number(amount),
      operationId: opId,
      balanceBefore: before,
      balanceAfter: u.walletBalance,
      metadata: { source: 'withdraw', status: tx.status }
    }], { session });
    await sendBalanceUpdateEvent(app, userId, {
      userId: userId.toString(),
      transactionId: tx._id.toString(),
      status: tx.status,
      balance: u.walletBalance,
      amountGross: tx.amountGross,
      feeAmount: tx.feeAmount,
      amountNet: tx.amountNet,
      timestamp: new Date().toISOString()
    });
    return { applied: true, balance: u.walletBalance };
  });
}


async function applyLedgerCreditRefund(app, userId, tx) {
  const opId = `refund:${tx._id.toString()}`;
  return runWithTransactionOrFallback(async (session) => {
    const existing = await WalletLedger.findOne({ operationId: opId }).session(session);
    const u = await User.findById(userId).session(session);
    if (existing) {
      return { applied: false, balance: u?.walletBalance ?? null };
    }

    const hadReserve = await WalletLedger.findOne({ operationId: `reserve:${tx._id.toString()}` }).session(session);
    const legacyDebited = Array.isArray(tx?.logs) && tx.logs.some(l => l.message === 'Wallet debited');
    if (!hadReserve && !legacyDebited) {
      return { applied: false, balance: u?.walletBalance ?? null };
    }
    const before = round2(u?.walletBalance || 0);
    const amount = Number(tx.amountNet);
    u.walletBalance = round2(before + amount);
    await u.save({ session });
    await WalletLedger.create([{
      userId,
      txId: tx._id,
      direction: 'credit',
      reason: 'withdraw_refund',
      amount,
      operationId: opId,
      balanceBefore: before,
      balanceAfter: u.walletBalance,
      metadata: { source: 'withdraw', status: 'failed' }
    }], { session });
    await sendBalanceUpdateEvent(app, userId, {
      userId: userId.toString(),
      transactionId: tx._id.toString(),
      status: tx.status,
      balance: u.walletBalance,
      amountGross: tx.amountGross,
      feeAmount: tx.feeAmount,
      amountNet: tx.amountNet,
      timestamp: new Date().toISOString()
    });
    return { applied: true, balance: u.walletBalance };
  });
}


async function applyLedgerDebitSettle(app, userId, tx) {
  const opId = `settle:${tx._id.toString()}`;
  return runWithTransactionOrFallback(async (session) => {
    const existing = await WalletLedger.findOne({ operationId: opId }).session(session);
    if (existing) {
      const u = await User.findById(userId).session(session);
      return { applied: false, balance: u?.walletBalance ?? null };
    }
    const u = await User.findById(userId).session(session);
    if (!u || Number(u.walletBalance) < Number(tx.amountNet)) {

      return { applied: false, balance: u?.walletBalance ?? null };
    }
    const before = round2(u.walletBalance || 0);
    const amount = Number(tx.amountNet);
    u.walletBalance = round2(before - amount);
    await u.save({ session });
    await WalletLedger.create([{
      userId,
      txId: tx._id,
      direction: 'debit',
      reason: 'withdraw_settle',
      amount,
      operationId: opId,
      balanceBefore: before,
      balanceAfter: u.walletBalance,
      metadata: { source: 'withdraw', status: 'withdraw_completed' }
    }], { session });
    await sendBalanceUpdateEvent(app, userId, {
      userId: userId.toString(),
      transactionId: tx._id.toString(),
      status: tx.status,
      balance: u.walletBalance,
      amountGross: tx.amountGross,
      feeAmount: tx.feeAmount,
      amountNet: tx.amountNet,
      timestamp: new Date().toISOString()
    });
    return { applied: true, balance: u.walletBalance };
  });
}

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function normalizePixType(t) {
  const u = String(t || '').toUpperCase().trim();
  if (u === 'CPF') return 'CPF';
  if (u === 'CNPJ') return 'CNPJ';
  return null;
}

function normalizePixKeyByType(type, key) {
  const digits = onlyDigits(key);
  if (type === 'PHONE' || type === 'CPF' || type === 'CNPJ') return digits;
  return digits;
}

function computePixFingerprint(type, normalizedKey) {
  const h = crypto.createHash('sha256').update(`${type}:${normalizedKey}`).digest('hex');
  return `sha256:${h}`;
}

function maskPixKey(type, normalizedKey) {
  const n = String(normalizedKey || '');
  if (!type || !n) return null;
  if (type === 'PHONE') return `(**) *****-${n.slice(-4)}`;
  if (type === 'CPF') return `***.***.***-${n.slice(-2)}`;
  if (type === 'CNPJ') return `**.***.***/****-${n.slice(-2)}`;
  return `****${n.slice(-4)}`;
}

const IS_ASAAS_PROD = (process.env.ASAAS_API_BASE || '').includes('api.asaas.com');


function addBusinessDays(start, days) {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) {
      added++;
    }
  }
  return d;
}

async function sendBalanceUpdateEvent(app, userId, payload) {
  try {
    const notificationService = app?.locals?.notificationService;
    if (notificationService) {

      notificationService.sendToUser(String(userId), {
        type: 'wallet:balance_updated',
        data: payload
      });
    }
  } catch (_) {}
}

async function sendEscrowUpdateEvent(app, userId, escrowBalance, balance) {
  try {
    const notificationService = app?.locals?.notificationService;
    if (notificationService) {
      const normalizedBalance = typeof balance === 'number' ? round2(balance) : undefined;
      notificationService.sendToUser(String(userId), {
        type: 'wallet:escrow_updated',
        data: {
          userId: String(userId),
          escrowBalance: round2(escrowBalance),
          balance: normalizedBalance,
          timestamp: new Date().toISOString()
        }
      });
    }
  } catch (_) {}
}

async function calculateAndSendEscrowUpdate(app, userId) {
  try {
    const Purchase = require('../models/Purchase');
    const AcceptedProposal = require('../models/AcceptedProposal');
    const User = require('../models/User');

    let totalEscrow = 0;

    const userIdString = typeof userId === 'string' ? userId : userId?.toString?.();
    if (!userIdString) {
      return 0;
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(userIdString);
    let normalizedObjectId = isObjectId ? new mongoose.Types.ObjectId(userIdString) : null;

    // Buscar usuário tanto por _id quanto por userid legado
    let userDoc = null;
    if (normalizedObjectId) {
      userDoc = await User.findById(normalizedObjectId).select('_id walletBalance userid');
    }
    if (!userDoc) {
      userDoc = await User.findOne({ userid: userIdString }).select('_id walletBalance userid');
      if (userDoc?._id) {
        normalizedObjectId = userDoc._id;
      }
    }

    if (!normalizedObjectId && userDoc?._id) {
      normalizedObjectId = userDoc._id;
    }

    if (normalizedObjectId) {
      const purchases = await Purchase.find({
        sellerId: normalizedObjectId,
        status: { $in: ['escrow_reserved', 'shipped', 'delivered'] }
      }).select('sellerReceives');
      for (const purchase of purchases) {
        totalEscrow += purchase.sellerReceives || 0;
      }

      const proposals = await AcceptedProposal.find({
        'booster.userid': normalizedObjectId,
        status: 'active'
      }).select('price');

      for (const proposal of proposals) {
        totalEscrow += proposal.price || 0;
      }
    } else {
      logger.warn('[EscrowUpdate] Usuário não encontrado para calcular escrow', { userId: userIdString });
    }

    const balance = userDoc?.walletBalance || 0;

    await sendEscrowUpdateEvent(app, userId, totalEscrow, balance);

    return totalEscrow;
  } catch (error) {
    logger.error('Erro ao calcular/enviar escrow update:', error);
    return 0;
  }
}

async function sendWalletNotification(app, userId, notification) {
  try {
    const notificationService = app?.locals?.notificationService;
    if (notificationService) {
      notificationService.sendNotification(String(userId), notification).catch(() => {});
    }
  } catch (_) {}
}

function afterResponse(res, fn) {
  try {

    res.on('finish', () => {
      try { fn(); } catch (_) {}
    });
  } catch (_) {

    try { setTimeout(fn, 0); } catch (__) {}
  }
}


async function reconcilePendingWithdrawsForUser(app, userId, { limit = 10, timeoutMs = 4500 } = {}) {
  const result = { checked: 0, completed: 0, failed: 0, unchanged: 0 };
  try {
    const pendings = await WalletTransaction.find({
      userId,
      type: 'withdraw',
      status: { $in: ['withdraw_pending', 'processing'] }
    }).sort('-createdAt').limit(limit);
    for (const tx of pendings) {
      result.checked++;
      if (!tx.asaasTransferId) { result.unchanged++; continue; }
      let t;
      try {
        t = await AsaasService.getTransferWithTimeout(tx.asaasTransferId, timeoutMs);
      } catch (e) {
        result.unchanged++;
        continue;
      }
      const tStatus = String(t?.status || '').toUpperCase();
      if (tStatus.includes('DONE') || tStatus.includes('CONFIRMED') || tStatus === 'COMPLETED' || tStatus === 'PAID') {
        if (tx.status !== 'withdraw_completed') {
          tx.status = 'withdraw_completed';
          tx.logs.push({ level: 'info', message: 'Reconciled: transfer confirmed', data: { transferId: tx.asaasTransferId, status: tStatus }, at: new Date().toISOString() });
          const user = await User.findById(tx.userId);
          if (user) {
            const alreadyDebited = tx.logs.some(l => l.message === 'Wallet debited');
            if (!alreadyDebited) {
              const settle = await applyLedgerDebitSettle(app, tx.userId, tx);
              if (settle?.applied) {
                tx.logs.push({ level: 'info', message: 'Wallet debited', data: { newBalance: settle.balance }, at: new Date().toISOString() });
              }
            }
            if (!user.pixKeyLocked) {
              user.pixKeyLocked = true;
              if (!user.pixKeyFirstWithdrawAt) user.pixKeyFirstWithdrawAt = new Date();
              try { await user.save(); } catch (_) {}
            }
          }
          await tx.save();
          result.completed++;
        } else {
          result.unchanged++;
        }
      } else if (tStatus.includes('FAILED') || tStatus.includes('CANCELLED') || tStatus.includes('REFUSED')) {
        if (tx.status !== 'failed') {
          const refunded = await applyLedgerCreditRefund(app, tx.userId, tx);
          if (refunded?.applied) {
            tx.logs.push({ level: 'warn', message: 'Wallet refunded', data: { reason: 'reconcile_failed' }, at: new Date().toISOString() });
          }
          tx.status = 'failed';
          tx.logs.push({ level: 'error', message: 'Reconciled: transfer failed/cancelled', data: { transferId: tx.asaasTransferId, status: tStatus }, at: new Date().toISOString() });
          await tx.save();
          result.failed++;
        } else {
          result.unchanged++;
        }
      } else {
        result.unchanged++;
      }
    }
  } catch (_) {}
  return result;
}

async function handleWithdrawTimeoutsForUser(app, userId) {
  try {
    const now = new Date();

    const pendings = await WalletTransaction.find({
      userId,
      type: 'withdraw',
      status: { $in: ['withdraw_pending', 'processing'] }
    }).limit(20);

    for (const tx of pendings) {
      const deadline = addBusinessDays(tx.createdAt || tx.updatedAt || new Date(0), 1);
      if (now < deadline) continue;


      let tStatus = 'UNKNOWN';
      if (tx.asaasTransferId) {
        try {
          const t = await AsaasService.getTransfer(tx.asaasTransferId);
          tStatus = String(t?.status || '').toUpperCase();
        } catch (_) {}
      }


      if (['DONE','CONFIRMED','COMPLETED','PAID'].some(s => tStatus.includes(s))) {
        if (tx.status !== 'withdraw_completed') {
          tx.status = 'withdraw_completed';
          tx.logs.push({ level: 'info', message: 'Withdraw finalized by timeout check (completed at provider)' });
          await tx.save();

          await sendWalletNotification(app, userId, {
            title: 'Saque aprovado',
            body: `Saque confirmado pelo provedor`,
            type: 'wallet_withdraw',
            data: { transactionId: tx._id, status: tx.status }
          });
        }
        continue;
      }


      const resu = await applyLedgerCreditRefund(app, userId, tx);
      if (resu && resu.applied) {
        tx.status = 'failed';
        tx.logs.push({ level: 'warn', message: 'Wallet refunded', data: { reason: 'timeout_1_business_day' } });
        await tx.save();
        await sendWalletNotification(app, userId, {
          title: 'Saque extornado',
          body: 'Seu saque não foi aprovado em 1 dia útil e o valor foi devolvido à sua carteira.',
          type: 'wallet_withdraw_refund',
          data: { transactionId: tx._id, amount: tx.amountNet }
        });
      }
    }
  } catch (_) {}
}


router.post('/deposits/initiate', auth, async (req, res) => {
  try {
    const user = req.user;
    const { amount, description, cpfCnpj: cpfCnpjBody } = req.body || {};
    const amountNum = Number(amount);

    if (!amountNum || amountNum <= 0) {
      return res.status(400).json({ success: false, message: 'Valor inválido' });
    }

    const feeAmount = round2((amountNum * FEE_PERCENT) / 100);
    const amountNet = round2(amountNum - feeAmount);


    let cpfCnpj = user.cpfCnpj || cpfCnpjBody || undefined;
    if (IS_ASAAS_PROD) {
      cpfCnpj = onlyDigits(cpfCnpj);
      if (!cpfCnpj || ![11, 14].includes(cpfCnpj.length)) {
        return res.status(400).json({
          success: false,
          message: 'Para depósitos é obrigatório informar CPF (11 dígitos) ou CNPJ (14 dígitos).',
          error: 'MISSING_CPF_CNPJ'
        });
      }

      if (!user.cpfCnpj) {
        try {
          user.cpfCnpj = cpfCnpj;
          await user.save();
        } catch (_) {}
      }
    }


    const customer = await AsaasService.getOrCreateCustomer({
      name: user.name || user.email,
      email: user.email,
      cpfCnpj: cpfCnpj
    });

    let ensuredCustomer = await AsaasService.ensureCustomerHasCpfCnpj(
      customer.id || customer._id || customer.customer || customer.customerId,
      cpfCnpj
    );
    let customerId = ensuredCustomer?.id || customer.id || customer._id || customer.customer || customer.customerId;


    const tx = await WalletTransaction.create({
      userId: user._id,
      type: 'deposit',
      amountGross: amountNum,
      feePercent: FEE_PERCENT,
      feeAmount,
      amountNet,
      status: 'pending',
      logs: [{ level: 'info', message: 'Deposit initiated', data: { amountNum, feeAmount, amountNet } }]
    });

    const externalReference = `wallet_tx_${tx._id.toString()}`;


    let payment;
    try {
      payment = await AsaasService.createPixPayment({
        customerId,
        value: amountNum,
        description: description || `Depósito Zenith #${tx._id.toString()}`,
        externalReference
      });
    } catch (err) {
      const code = err?.response?.data?.errors?.[0]?.code || err?.response?.data?.error || '';
      if (String(code).includes('invalid_customer.cpfCnpj')) {
        logger.warn('Asaas payment failed due to missing cpfCnpj on customer; re-ensuring and retrying', { customerId, userId: user._id.toString() });
        try {
          ensuredCustomer = await AsaasService.ensureCustomerHasCpfCnpj(customerId, cpfCnpj);
          customerId = ensuredCustomer?.id || customerId;
          payment = await AsaasService.createPixPayment({
            customerId,
            value: amountNum,
            description: description || `Depósito Zenith #${tx._id.toString()}`,
            externalReference
          });
        } catch (err2) {
          logger.error('Retry createPixPayment after ensuring cpfCnpj failed', { message: err2.message, code: err2?.response?.data?.errors?.[0]?.code });
          throw err2;
        }
      } else {
        throw err;
      }
    }


    tx.asaasPaymentId = payment.id;
    tx.externalReference = externalReference;
    tx.logs.push({ level: 'info', message: 'Asaas payment created', data: { paymentId: payment.id } });
    await tx.save();


    try {
      const qr = await AsaasService.getPixQrCodeWithRetry(payment.id, { attempts: 2, delayMs: 750, timeoutMs: 4000 });
      return res.json({
        success: true,
        data: {
          transactionId: tx._id,
          asaasPaymentId: payment.id,
          pix: {
            encodedImage: qr.encodedImage,
            payload: qr.payload,
            expirationDate: qr.expirationDate
          },
          breakdown: {
            amountGross: amountNum,
            feePercent: FEE_PERCENT,
            feeAmount,
            amountNet
          }
        },
        message: 'Depósito iniciado.'
      });
    } catch (qrErr) {
      logger.warn('Asaas pixQrCode not ready or transient error; returning pending', { paymentId: payment.id, message: qrErr.message });
      return res.status(202).json({
        success: true,
        data: {
          transactionId: tx._id,
          asaasPaymentId: payment.id,
          pix: null,
          qrPending: true,
          qrFetchUrl: `/api/wallet/deposits/qr?paymentId=${payment.id}`,
          breakdown: {
            amountGross: amountNum,
            feePercent: FEE_PERCENT,
            feeAmount,
            amountNet
          }
        },
        message: 'Depósito iniciado. QR Code será disponibilizado em instantes.'
      });
    }
  } catch (error) {
    logger.error('Wallet deposit initiate error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao iniciar depósito', error: error.message });
  }
});



router.get('/deposits/qr', auth, async (req, res) => {
  try {
    const { paymentId: qp, transactionId } = req.query || {};
    let paymentId = String(qp || '').trim();
    let tx = null;

    if (!paymentId) {
      if (!transactionId) {
        return res.status(400).json({ success: false, message: 'Informe paymentId ou transactionId' });
      }
      tx = await WalletTransaction.findOne({ _id: transactionId, userId: req.user._id });
      if (!tx) return res.status(404).json({ success: false, message: 'Transação não encontrada' });
      paymentId = tx.asaasPaymentId;
      if (!paymentId) return res.status(400).json({ success: false, message: 'Transação não possui paymentId vinculado' });
    }

    try {
      const qr = await AsaasService.getPixQrCodeWithRetry(paymentId, { attempts: 3, delayMs: 800, timeoutMs: 6000 });

      if (tx) {
        try { tx.logs.push({ level: 'info', message: 'Pix QR Code fetched' }); await tx.save(); } catch (_) {}
      }
      return res.json({
        success: true,
        data: {
          paymentId,
          pix: {
            encodedImage: qr.encodedImage,
            payload: qr.payload,
            expirationDate: qr.expirationDate
          }
        }
      });
    } catch (e) {
      const status = e?.response?.status;
      const code = e?.code;
      const transient = code === 'ECONNABORTED' || !status || status >= 500 || status === 400 || status === 404 || status === 409;
      if (transient) {
        return res.status(202).json({ success: true, data: { paymentId, pix: null, qrPending: true } });
      }
      return res.status(502).json({ success: false, message: 'Falha ao obter QR Code Pix', error: e.message });
    }
  } catch (err) {
    logger.error('Wallet deposit QR fetch error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao consultar QR Code', error: err.message });
  }
});


router.get('/pix-key', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('pixKeyType pixKeyNormalized pixKeyLocked pixKeyLinkedAt pixKeyFirstWithdrawAt');
    const type = user?.pixKeyType || null;
    const keyMasked = type ? maskPixKey(type, user.pixKeyNormalized || '') : null;
    return res.json({
      success: true,
      data: {
        type,
        keyMasked,
        locked: !!user?.pixKeyLocked,
        linkedAt: user?.pixKeyLinkedAt,
        firstWithdrawAt: user?.pixKeyFirstWithdrawAt
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao consultar chave PIX', error: error.message });
  }
});


router.post('/pix-key', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.pixKeyLinkedAt) {
      return res.status(409).json({ success: false, message: 'Chave PIX já vinculada ao seu usuário.', error: 'PIX_KEY_ALREADY_LINKED' });
    }

    const { pixKey, pixKeyType } = req.body || {};
    if (!pixKey || !pixKeyType) {
      return res.status(400).json({ success: false, message: 'Chave Pix e tipo são obrigatórios', error: 'MISSING_PIX_KEY' });
    }

    const t = normalizePixType(pixKeyType);
    if (!t) return res.status(400).json({ success: false, message: 'Tipo de chave PIX não permitido. Utilize CPF ou CNPJ.', error: 'UNSUPPORTED_PIX_KEY_TYPE', allowedTypes: ['cpf','cnpj'] });
    const digits = normalizePixKeyByType(t, pixKey);
    if (t === 'CPF' && digits.length !== 11) return res.status(400).json({ success: false, message: 'Chave PIX CPF inválida. Informe 11 dígitos.', error: 'INVALID_PIX_KEY' });
    if (t === 'CNPJ' && digits.length !== 14) return res.status(400).json({ success: false, message: 'Chave PIX CNPJ inválida. Informe 14 dígitos.', error: 'INVALID_PIX_KEY' });

    const fp = computePixFingerprint(t, digits);
    const exists = await User.findOne({ pixKeyFingerprint: fp, _id: { $ne: user._id } }).select('_id');
    if (exists) return res.status(409).json({ success: false, message: 'Esta chave PIX já está vinculada a outra conta.', error: 'PIX_KEY_ALREADY_IN_USE' });

    user.pixKeyType = t;
    user.pixKeyNormalized = digits;
    user.pixKeyFingerprint = fp;
    user.pixKeyLinkedAt = new Date();
    user.pixKeyLocked = false;
    try {
      await user.save();
    } catch (e) {
      if (e && e.code === 11000) {
        return res.status(409).json({ success: false, message: 'Esta chave PIX já está vinculada a outra conta.', error: 'PIX_KEY_ALREADY_IN_USE' });
      }
      throw e;
    }

    return res.json({ success: true, message: 'Chave PIX vinculada com sucesso.', data: { type: user.pixKeyType, keyMasked: maskPixKey(user.pixKeyType, user.pixKeyNormalized), locked: user.pixKeyLocked, linkedAt: user.pixKeyLinkedAt } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao vincular chave PIX', error: error.message });
  }
});



router.post('/withdraw/reconcile', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { transferId, transactionId } = req.body || {};

    if (!transferId && !transactionId) {
      return res.status(400).json({ success: false, message: 'Informe transferId ou transactionId' });
    }


    const txQuery = transactionId
      ? { _id: transactionId, userId }
      : { asaasTransferId: transferId, userId };
    let tx = await WalletTransaction.findOne(txQuery);
    if (!tx) {

      if (transferId) {
        try {
          const t = await AsaasService.getTransfer(transferId);
          const extRef = t?.externalReference;
          const tVal = Number(t?.value || t?.netValue || t?.totalValue || 0);
          const desc = String(t?.description || '');


          if (extRef) {
            try {
              const byExt = await WalletTransaction.findOne({ externalReference: extRef, userId });
              if (byExt) {
                byExt.asaasTransferId = transferId;
                byExt.logs.push({ level: 'info', message: 'Linked via reconcile by externalReference', data: { transferId, externalReference: extRef } });
                await byExt.save();
                tx = byExt;
              }
            } catch (_) {}
          }


          if (!tx) {
            const m = desc.match(/\btx\s+([0-9a-fA-F]{24})\b/);
            if (m && m[1]) {
              try {
                const byId = await WalletTransaction.findOne({ _id: m[1], userId });
                if (byId) {
                  byId.asaasTransferId = transferId;
                  byId.logs.push({ level: 'info', message: 'Linked via reconcile by description', data: { transferId, desc } });
                  await byId.save();
                  tx = byId;
                }
              } catch (_) {}
            }
          }


          if (!tx && tVal > 0) {
            try {
              const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
              const candidates = await WalletTransaction.find({
                userId,
                type: 'withdraw',
                status: 'withdraw_pending',
                asaasTransferId: { $in: [null, undefined, ''] },
                createdAt: { $gte: since }
              }).limit(10);
              const matches = candidates.filter(c => Math.abs(Number(c.amountGross) - tVal) <= 0.01);
              if (matches.length === 1) {
                const chosen = matches[0];
                chosen.asaasTransferId = transferId;
                chosen.logs.push({ level: 'info', message: 'Linked via reconcile by value fallback', data: { transferId, tVal } });
                await chosen.save();
                tx = chosen;
              }
            } catch (_) {}
          }
        } catch (_) {}
      }

      if (!tx) {
        return res.status(404).json({ success: false, message: 'Transação não encontrada' });
      }
    }


    if (['withdraw_completed', 'failed'].includes(tx.status)) {
      const u = await User.findById(userId);
      return res.json({ success: true, data: { status: tx.status, balance: round2(u?.walletBalance || 0) } });
    }

    const asaasTransferId = tx.asaasTransferId || transferId;
    if (!asaasTransferId) {
      return res.status(400).json({ success: false, message: 'transferId ausente para reconciliação' });
    }


    let t;
    try {
      t = await AsaasService.getTransfer(asaasTransferId);
    } catch (err) {
      return res.status(502).json({ success: false, message: 'Falha ao consultar transferência na Asaas', error: err?.message });
    }

    const status = String(t?.status || '').toUpperCase();
    if (status.includes('DONE') || status.includes('CONFIRMED') || status === 'COMPLETED' || status === 'PAID') {

      // Proceed without setting invalid 'processing' status; rely on idempotent ledger operations
      await WalletTransaction.updateOne(
        { _id: tx._id, status: { $in: ['withdraw_pending', 'withdraw_completed', 'failed'] } },
        { $push: { logs: { level: 'info', message: 'Manual reconcile started', at: new Date().toISOString() } } }
      );

      const fresh = await WalletTransaction.findById(tx._id);
      if (!fresh) return res.json({ success: true, data: { status: 'unknown' } });

      if (fresh.status !== 'withdraw_completed') {
        fresh.status = 'withdraw_completed';
        fresh.logs.push({ level: 'info', message: 'Withdraw confirmed via manual reconcile', data: { asaasTransferId, status } });

        const user = await User.findById(userId);
        if (user) {

          const alreadyDebited = fresh.logs.some(l => l.message === 'Wallet debited');
          if (!alreadyDebited) {
            const settle = await applyLedgerDebitSettle(req.app, userId, fresh);
            if (settle?.applied) {
              fresh.logs.push({ level: 'info', message: 'Wallet debited', data: { newBalance: settle.balance } });
            }
          }

          if (!user.pixKeyLocked) {
            user.pixKeyLocked = true;
            if (!user.pixKeyFirstWithdrawAt) user.pixKeyFirstWithdrawAt = new Date();
            try { await user.save(); } catch (_) {}
          }
        }

        await fresh.save();

        try {
          const notificationService = req.app?.locals?.notificationService;
          if (notificationService) {
            await notificationService.sendToUser(userId.toString(), {
              type: 'wallet:balance_updated',
              data: {
                userId: userId.toString(),
                transactionId: fresh._id.toString(),
                status: fresh.status,
                balance: (await User.findById(userId))?.walletBalance,
                amountGross: fresh.amountGross,
                feeAmount: fresh.feeAmount,
                amountNet: fresh.amountNet,
                timestamp: new Date().toISOString()
              }
            });

            await notificationService.sendNotification(userId.toString(), {
              title: 'Saque confirmado (reconciliação)',
              body: `R$ ${fresh.amountNet.toFixed(2)} enviados via Pix`,
              type: 'wallet_withdraw',
              data: { transactionId: fresh._id, amount: fresh.amountNet }
            });
          }
        } catch (_) {}

        const u2 = await User.findById(userId);
        return res.json({ success: true, data: { status: fresh.status, balance: round2(u2?.walletBalance || 0) } });
      }

      const u3 = await User.findById(userId);
      return res.json({ success: true, data: { status: fresh.status, balance: round2(u3?.walletBalance || 0) } });
    }

    if (status.includes('FAILED') || status.includes('CANCELLED') || status.includes('REFUSED')) {

      const u = await User.findById(userId);
      try {
        const refunded = await applyLedgerCreditRefund(req.app, userId, tx);
        if (refunded?.applied) {
          tx.logs.push({ level: 'warn', message: 'Wallet refunded', data: { reason: 'manual_reconcile_failed' } });
        }
      } catch (_) {}
      tx.status = 'failed';
      tx.logs.push({ level: 'error', message: 'Withdraw failed via manual reconcile', data: { asaasTransferId, status } });
      await tx.save();
      const u2 = await User.findById(userId);
      return res.json({ success: true, data: { status: tx.status, balance: round2(u2?.walletBalance || 0) } });
    }

    return res.json({ success: true, data: { status: 'pending' } });
  } catch (error) {
    logger.error('Withdraw reconcile error:', error);
    return res.status(500).json({ success: false, message: 'Erro na reconciliação', error: error.message });
  }
});



router.post('/webhook/asaas', express.json({ type: '*/*' }), async (req, res) => {
  try {
    const hdr = req.headers || {};
    const providedToken = hdr['asaas-access-token']
      || hdr['asaas_access_token']
      || hdr['x-asaas-token']
      || hdr['access_token']
      || hdr['access-token']
      || (typeof hdr['authorization'] === 'string' && hdr['authorization'].startsWith('Bearer ')
          ? hdr['authorization'].slice(7)
          : undefined)
      || req.query.token;
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (expected && providedToken !== expected) {
      return res.status(401).json({ success: false, message: 'Invalid webhook token' });
    }

    const event = req.body || {};

    const eventType = event.event || event.type;

    if (!eventType) {
      return res.status(400).json({ success: false, message: 'Invalid event' });
    }

    logger.info('[Asaas Webhook] Received event', { eventType });


    const evUpper = String(eventType).toUpperCase();
    const isDepositEvent = evUpper === 'PAYMENT_RECEIVED' || evUpper === 'PAYMENT_CONFIRMED' || evUpper.startsWith('PAYMENT');
    if (isDepositEvent) {
      let payment = event.payment || event.data || {};
      const paymentId = payment.id || event.paymentId || event.id;


      // If minimal payload received, fetch full payment details from Asaas to get externalReference/status
      if ((!payment || !payment.externalReference || !payment.billingType) && paymentId) {
        try {
          const fetched = await AsaasService.getPayment(paymentId);
          if (fetched && typeof fetched === 'object') payment = { ...fetched, id: fetched.id || paymentId };
        } catch (_) {}
      }

      const billingType = String(payment.billingType || '').toUpperCase();
      if (billingType && billingType !== 'PIX') {
        logger.warn('[Asaas Webhook] PAYMENT_RECEIVED but not PIX, ignoring', { billingType });
        return res.json({ received: true });
      }

      if (!paymentId) {
        logger.warn('Webhook payment without id');
        return res.json({ received: true });
      }


      let tx = await WalletTransaction.findOne({ asaasPaymentId: paymentId });
      if (!tx) {
        const extRef = payment.externalReference || event.externalReference;
        if (extRef) {
          try {
            const byExt = await WalletTransaction.findOne({ externalReference: extRef, type: 'deposit' });
            if (byExt) {
              byExt.asaasPaymentId = paymentId;
              byExt.logs.push({ level: 'info', message: 'Linked via webhook by externalReference', data: { paymentId, externalReference: extRef } });
              await byExt.save();
              tx = byExt;
            }
          } catch (_) {}
        }
        if (!tx && paymentId) {
          // Fallback: if we fetched details above and found tx id in description
          const desc = String(payment.description || '');
          const m = desc.match(/#([0-9a-fA-F]{24})\b/);
          if (m && m[1]) {
            try {
              const byId = await WalletTransaction.findOne({ _id: m[1], type: 'deposit' });
              if (byId) {
                byId.asaasPaymentId = paymentId;
                byId.logs.push({ level: 'info', message: 'Linked via webhook by description', data: { paymentId, desc } });
                await byId.save();
                tx = byId;
              }
            } catch (_) {}
          }
        }
      }
      if (!tx) {
        logger.warn('Webhook payment with unknown local transaction', { paymentId, externalReference: payment?.externalReference });
        return res.json({ received: true });
      }

      // Determine if payment is final (received/confirmed)
      const pStatus = String(payment.status || '').toUpperCase();
      const isFinal = (evUpper === 'PAYMENT_RECEIVED' || evUpper === 'PAYMENT_CONFIRMED' || ['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(pStatus));

      if (!isFinal) {
        // Non-final events: just log and return, do not change status
        await WalletTransaction.updateOne(
          { _id: tx._id },
          { $push: { logs: { level: 'info', message: 'Ignoring non-final payment event', data: { eventType: evUpper, status: pStatus }, at: new Date().toISOString() } } }
        );
        return res.json({ received: true });
      }

      // Final events: atomically move to 'paid' if pending/paid and continue
      await WalletTransaction.updateOne(
        { _id: tx._id, status: { $in: ['pending', 'paid'] } },
        {
          $set: { status: 'paid' },
          $push: { logs: { level: 'info', message: 'Asaas webhook processing lock acquired', at: new Date().toISOString() } }
        }
      );

      const txLocked = await WalletTransaction.findById(tx._id);
      if (!txLocked) return res.json({ received: true });


      const providerValue = Number(payment.value || 0);
      const providerNet = Number(payment.netValue || 0);
      const approx = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.01;
      const valueMatches = providerValue ? approx(providerValue, txLocked.amountGross) : false;
      const netMatchesGross = providerNet ? approx(providerNet, txLocked.amountGross) : false;
      const netMatchesNet = providerNet ? approx(providerNet, txLocked.amountNet) : false;
      if (!(valueMatches || netMatchesGross || netMatchesNet)) {
        txLocked.logs.push({ level: 'warn', message: 'Payment value mismatch (ignored)', data: { providerValue, providerNet, expectedGross: txLocked.amountGross, expectedNet: txLocked.amountNet } });
        // Continue processing to avoid missing credit due to provider fee differences
      }


      txLocked.status = 'paid';
      txLocked.logs.push({ level: 'info', message: 'Payment confirmed', at: new Date().toISOString() });

      const user = await User.findById(txLocked.userId);
      if (!user) {
        txLocked.status = 'failed';
        txLocked.logs.push({ level: 'error', message: 'User not found to credit' });
        await txLocked.save();
        return res.json({ received: true });
      }

      const dep = await applyLedgerCreditDeposit(req.app, user._id, txLocked);
      txLocked.status = 'credited';
      txLocked.logs.push({ level: 'info', message: 'Wallet credited', data: { newBalance: dep?.balance }, at: new Date().toISOString() });


      txLocked.logs.push({ level: 'info', message: 'Mediator fee transfer disabled — skipping', at: new Date().toISOString() });

      await txLocked.save();


      try {
        const notificationService = req.app?.locals?.notificationService;
        if (notificationService) {

          await notificationService.sendToUser(txLocked.userId.toString(), {
            type: 'wallet:balance_updated',
            data: {
              userId: txLocked.userId.toString(),
              transactionId: txLocked._id.toString(),
              status: txLocked.status,
              balance: user.walletBalance,
              amountGross: txLocked.amountGross,
              feeAmount: txLocked.feeAmount,
              amountNet: txLocked.amountNet,
              timestamp: new Date().toISOString()
            }
          });


          await notificationService.sendNotification(txLocked.userId.toString(), {
            title: 'Depósito confirmado',
            body: `R$ ${txLocked.amountNet.toFixed(2)} creditados.`,
            type: 'wallet_deposit',
            data: {
              transactionId: txLocked._id,
              amountGross: txLocked.amountGross,
              feeAmount: txLocked.feeAmount,
              amountNet: txLocked.amountNet,
              balance: user.walletBalance
            }
          });
        }
      } catch (_) {}

      return res.json({ received: true });
    }


    if (evUpper.includes('TRANSFER')) {
      const transfer = event.transfer || event.data || {};
      const transferId = transfer.id || event.transferId || event.id;
      if (!transferId) {
        logger.warn('[Asaas Webhook] TRANSFER event without id');
        return res.json({ received: true });
      }


      let tx = await WalletTransaction.findOne({ asaasTransferId: transferId });
      if (!tx) {

        const extRef = transfer.externalReference || event.externalReference;
        if (extRef) {
          try {
            const byExt = await WalletTransaction.findOne({ externalReference: extRef });
            if (byExt) {
              byExt.asaasTransferId = transferId;
              byExt.logs.push({ level: 'info', message: 'Linked via webhook by externalReference', data: { transferId, externalReference: extRef } });
              await byExt.save();
              tx = byExt;
            }
          } catch (e) {
            logger.warn('[Asaas Webhook] Lookup by externalReference failed', { message: e.message, transferId, extRef });
          }
        }


        if (!tx) {
          const desc = String(transfer.description || '');
          const m = desc.match(/\btx\s+([0-9a-fA-F]{24})\b/);
          if (m && m[1]) {
            try {
              const byId = await WalletTransaction.findById(m[1]);
              if (byId) {
                byId.asaasTransferId = transferId;
                byId.logs.push({ level: 'info', message: 'Linked via webhook by description', data: { transferId, desc } });
                await byId.save();
                tx = byId;
              }
            } catch (e) {
              logger.warn('[Asaas Webhook] Fallback lookup by description failed', { message: e.message, transferId });
            }
          }


          if (!tx) {
            const tValue = Number(transfer.value || transfer.netValue || transfer.totalValue || 0);
            if (tValue > 0) {
              try {
                const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
                const candidates = await WalletTransaction.find({
                  type: 'withdraw',
                  status: 'withdraw_pending',
                  asaasTransferId: { $in: [null, undefined, ''] },
                  createdAt: { $gte: since }
                }).limit(10);
                const matches = candidates.filter(c => Math.abs(Number(c.amountGross) - tValue) <= 0.01);
                if (matches.length === 1) {
                  const chosen = matches[0];
                  chosen.asaasTransferId = transferId;
                  chosen.logs.push({ level: 'info', message: 'Linked via webhook by value fallback', data: { transferId, tValue } });
                  await chosen.save();
                  tx = chosen;
                }
              } catch (e) {
                logger.warn('[Asaas Webhook] Value fallback lookup failed', { message: e.message });
              }
            }
          }

          if (!tx) {
            logger.warn('[Asaas Webhook] TRANSFER event with unknown local transaction', { transferId, externalReference: extRef, desc });
            return res.json({ received: true });
          }
        }
      }


      await WalletTransaction.updateOne(
        { _id: tx._id, status: { $in: ['withdraw_pending', 'withdraw_completed', 'failed'] } },
        { $push: { logs: { level: 'info', message: 'Asaas transfer webhook processing started', at: new Date().toISOString() } } }
      );

      const txLocked = await WalletTransaction.findById(tx._id);
      if (!txLocked) return res.json({ received: true });

      const tStatus = String(transfer.status || '').toUpperCase();
      if (tStatus.includes('DONE') || tStatus.includes('CONFIRMED') || tStatus === 'COMPLETED' || tStatus === 'PAID') {
        txLocked.status = 'withdraw_completed';
        txLocked.logs.push({ level: 'info', message: 'Withdraw transfer confirmed via webhook', data: { transferId, status: tStatus }, at: new Date().toISOString() });


        const user = await User.findById(txLocked.userId);
        if (user) {
          const alreadyDebited = txLocked.logs.some(l => l.message === 'Wallet debited');
          if (!alreadyDebited) {
            const settle = await applyLedgerDebitSettle(req.app, txLocked.userId, txLocked);
            if (settle?.applied) {
              txLocked.logs.push({ level: 'info', message: 'Wallet debited', data: { newBalance: settle.balance }, at: new Date().toISOString() });
            }
          }

          if (!user.pixKeyLocked) {
            user.pixKeyLocked = true;
            if (!user.pixKeyFirstWithdrawAt) user.pixKeyFirstWithdrawAt = new Date();
            try { await user.save(); } catch (_) {}
          }
        }

        await txLocked.save();

        try {
          const notificationService = req.app?.locals?.notificationService;
          if (notificationService) {

            await notificationService.sendToUser(txLocked.userId.toString(), {
              type: 'wallet:balance_updated',
              data: {
                userId: txLocked.userId.toString(),
                transactionId: txLocked._id.toString(),
                status: txLocked.status,
                balance: user?.walletBalance,
                amountGross: txLocked.amountGross,
                feeAmount: txLocked.feeAmount,
                amountNet: txLocked.amountNet,
                timestamp: new Date().toISOString()
              }
            });

            await notificationService.sendNotification(txLocked.userId.toString(), {
              title: 'Saque confirmado',
              body: `R$ ${txLocked.amountNet.toFixed(2)} enviados via Pix`,
              type: 'wallet_withdraw',
              data: { transactionId: txLocked._id, amount: txLocked.amountNet }
            });
          }
        } catch (_) {}

        return res.json({ received: true });
      } else if (tStatus.includes('FAILED') || tStatus.includes('CANCELLED') || tStatus.includes('REFUSED')) {
        txLocked.status = 'failed';
        txLocked.logs.push({ level: 'error', message: 'Withdraw transfer failed via webhook', data: { transferId, status: tStatus }, at: new Date().toISOString() });


        const refunded = await applyLedgerCreditRefund(req.app, txLocked.userId, txLocked);
        if (refunded?.applied) {
          txLocked.logs.push({ level: 'warn', message: 'Wallet refunded', data: { reason: 'transfer_failed' }, at: new Date().toISOString() });
          await sendWalletNotification(req.app, txLocked.userId, {
            title: 'Saque rejeitado',
            body: 'Seu saque foi rejeitado e o valor foi devolvido à sua carteira.',
            type: 'wallet_withdraw_refund',
            data: { transactionId: txLocked._id, amount: txLocked.amountNet }
          });
        }

        await txLocked.save();
        return res.json({ received: true });
      } else {

        txLocked.status = 'withdraw_pending';
        txLocked.logs.push({ level: 'info', message: 'Withdraw transfer still pending via webhook', data: { transferId, status: tStatus }, at: new Date().toISOString() });
        await txLocked.save();
        return res.json({ received: true });
      }
    }


    return res.json({ received: true });
  } catch (error) {
    logger.error('Wallet webhook error:', error);
    return res.status(500).json({ success: false });
  }
});


router.get('/balance', auth, async (req, res) => {
  try {

    handleWithdrawTimeoutsForUser(req.app, req.user._id).catch(() => {});
    const user = await User.findById(req.user._id);
    return res.json({ success: true, data: { balance: round2(user.walletBalance || 0), currency: 'BRL' } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao obter saldo' });
  }
});


router.get('/transactions', auth, async (req, res) => {
  try {

    handleWithdrawTimeoutsForUser(req.app, req.user._id).catch(() => {});
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      WalletTransaction.find({ userId: req.user._id }).sort('-createdAt').skip(skip).limit(parseInt(limit)),
      WalletTransaction.countDocuments({ userId: req.user._id })
    ]);
    return res.json({ success: true, data: { items, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar transações' });
  }
});


router.post('/withdraw', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { amount, pixKey, pixKeyType } = req.body || {};
    const idemHeader = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    const idempotencyKey = String(req.body?.idempotencyKey || idemHeader || '').trim() || undefined;
    const amountNum = Number(amount);
    
    // 🛡️ VALIDAÇÃO 1: Verificar bloqueio por tentativas falhas
    try {
      const oneHourAgo = new Date(Date.now() - BLOCK_DURATION_MS);
      const failedAttempts = await WalletTransaction.countDocuments({
        userId: user._id,
        type: 'withdraw',
        status: 'failed',
        createdAt: { $gte: oneHourAgo },
        'logs.message': { $in: ['Withdraw transfer create failed', 'Wallet reserve failed'] }
      });
      
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        // Calcular tempo restante
        const oldestFailed = await WalletTransaction.findOne({
          userId: user._id,
          type: 'withdraw',
          status: 'failed',
          createdAt: { $gte: oneHourAgo }
        }).sort({ createdAt: 1 }).select('createdAt');
        
        const blockUntil = new Date(oldestFailed.createdAt.getTime() + BLOCK_DURATION_MS);
        const remainingMs = blockUntil.getTime() - Date.now();
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        
        logger.warn('[WITHDRAW] User blocked due to failed attempts', { 
          userId: user._id.toString(), 
          failedAttempts, 
          remainingMinutes 
        });
        
        return res.status(429).json({
          success: false,
          message: `Você excedeu o limite de ${MAX_FAILED_ATTEMPTS} tentativas falhas. Tente novamente em ${remainingMinutes} minuto${remainingMinutes > 1 ? 's' : ''}.`,
          error: 'TOO_MANY_FAILED_ATTEMPTS',
          data: {
            failedAttempts,
            maxAttempts: MAX_FAILED_ATTEMPTS,
            blockUntil: blockUntil.toISOString(),
            remainingMinutes
          }
        });
      }
    } catch (blockCheckErr) {
      logger.error('[WITHDRAW] Error checking failed attempts', { error: blockCheckErr.message });
    }
    
    // 🛡️ VALIDAÇÃO 2: Valor mínimo (deve ser maior que a taxa)
    if (!amountNum || amountNum <= WITHDRAW_FEE) {
      return res.status(400).json({ 
        success: false, 
        message: `Valor inválido. O valor mínimo de saque é R$ ${(WITHDRAW_FEE + 0.01).toFixed(2)} (taxa de R$ ${WITHDRAW_FEE.toFixed(2)} + valor líquido)`,
        error: 'INVALID_AMOUNT',
        data: { minAmount: WITHDRAW_FEE + 0.01, withdrawFee: WITHDRAW_FEE }
      });
    }
    
    // 🛡️ VALIDAÇÃO 3: Limite máximo de saque
    if (amountNum > MAX_WITHDRAW_AMOUNT) {
      logger.warn('[WITHDRAW] Amount exceeds maximum limit', { 
        userId: user._id.toString(), 
        requestedAmount: amountNum, 
        maxAmount: MAX_WITHDRAW_AMOUNT 
      });
      
      return res.status(400).json({
        success: false,
        message: `O valor máximo por saque é de R$ ${MAX_WITHDRAW_AMOUNT.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
        error: 'AMOUNT_EXCEEDS_LIMIT',
        data: {
          requestedAmount: amountNum,
          maxAmount: MAX_WITHDRAW_AMOUNT,
          difference: amountNum - MAX_WITHDRAW_AMOUNT
        }
      });
    }

    if ((!pixKey || !pixKeyType) && user.pixKeyLinkedAt) {

    } else if (!pixKey || !pixKeyType) {
      return res.status(400).json({ success: false, message: 'Chave Pix e tipo são obrigatórios' });
    }


    let normalizedPixKeyType;
    let digits;
    if (user.pixKeyLinkedAt) {

      const boundType = user.pixKeyType;
      const boundDigits = user.pixKeyNormalized;
      if (pixKey || pixKeyType) {
        const reqType = normalizePixType(pixKeyType);
        const reqDigits = normalizePixKeyByType(boundType || reqType, pixKey || '');
        if (!reqType || reqType !== boundType || (reqDigits && reqDigits !== boundDigits)) {
          return res.status(409).json({ success: false, message: 'Sua chave PIX já está vinculada e não pode ser alterada.', error: 'PIX_KEY_IMMUTABLE', data: { type: boundType } });
        }
      }
      normalizedPixKeyType = boundType;
      digits = boundDigits;
      if (normalizedPixKeyType === 'PHONE') {
        return res.status(400).json({ success: false, message: 'Chave PIX por Telefone não é suportada. Utilize CPF ou CNPJ.', error: 'UNSUPPORTED_PIX_KEY_TYPE', allowedTypes: ['cpf','cnpj'] });
      }
    } else {

      const t = normalizePixType(pixKeyType);
      if (!t) return res.status(400).json({ success: false, message: 'Tipo de chave PIX não permitido. Utilize CPF ou CNPJ.', error: 'UNSUPPORTED_PIX_KEY_TYPE', allowedTypes: ['cpf','cnpj'] });
      normalizedPixKeyType = t;
      digits = normalizePixKeyByType(t, pixKey);
      if (t === 'CPF' && digits.length !== 11) return res.status(400).json({ success: false, message: 'Chave PIX CPF inválida. Informe 11 dígitos.', error: 'INVALID_PIX_KEY' });
      if (t === 'CNPJ' && digits.length !== 14) return res.status(400).json({ success: false, message: 'Chave PIX CNPJ inválida. Informe 14 dígitos.', error: 'INVALID_PIX_KEY' });
      const fp = computePixFingerprint(t, digits);
      const exists = await User.findOne({ pixKeyFingerprint: fp, _id: { $ne: user._id } }).select('_id');
      if (exists) return res.status(409).json({ success: false, message: 'Esta chave PIX já está vinculada a outra conta.', error: 'PIX_KEY_ALREADY_IN_USE' });

      user.pixKeyType = t;
      user.pixKeyNormalized = digits;
      user.pixKeyFingerprint = fp;
      user.pixKeyLinkedAt = new Date();
      user.pixKeyLocked = false;
      try { await user.save(); } catch (e) {
        if (e && e.code === 11000) return res.status(409).json({ success: false, message: 'Esta chave PIX já está vinculada a outra conta.', error: 'PIX_KEY_ALREADY_IN_USE' });
        throw e;
      }
    }




    try { await reconcilePendingWithdrawsForUser(req.app, user._id, { limit: 25, timeoutMs: 4000 }); } catch (_) {}
    try { await expireStalePendingWithdrawsForUser(req.app, user._id); } catch (_) {}


    try {
      const today = startOfToday();
      const todayCount = await WalletTransaction.countDocuments({
        userId: user._id,
        type: 'withdraw',
        createdAt: { $gte: today },
        status: { $in: ['withdraw_pending', 'processing', 'withdraw_completed'] }
      });
      if (todayCount >= 1) {
        return res.status(409).json({
          success: false,
          message: 'Limite diário atingido: é permitido no máximo 1 saque por dia. Tente novamente amanhã.',
          error: 'WITHDRAW_DAILY_LIMIT_REACHED',
          data: { todayCount, nextResetAt: startOfTomorrow().toISOString() }
        });
      }
    } catch (_) {}


    if (idempotencyKey) {
      try {
        const existing = await WalletTransaction.findOne({ userId: user._id, type: 'withdraw', idempotencyKey });
        if (existing) {
          return res.json({
            success: true,
            data: {
              transactionId: existing._id,
              transferId: existing.asaasTransferId || null,
              transferStatus: String(existing.status || 'UNKNOWN').toUpperCase(),
              newBalance: round2(user.walletBalance || 0)
            },
            message: 'Operação idempotente: saque já existente retornado.'
          });
        }
      } catch (_) {}
    }

    // Calcular valores com taxa de saque
    const feeAmount = round2(WITHDRAW_FEE);
    const amountNet = round2(amountNum - feeAmount);
    
    if (amountNet <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Valor insuficiente após taxa de saque. Taxa: R$ ${feeAmount.toFixed(2)}`,
        error: 'INSUFFICIENT_AFTER_FEE',
        data: { withdrawFee: feeAmount }
      });
    }

    const tx = await WalletTransaction.create({
      userId: user._id,
      type: 'withdraw',
      amountGross: amountNum,
      feePercent: 0,
      feeAmount: feeAmount,
      amountNet: amountNet,
      status: 'withdraw_pending',
      withdrawPixKey: digits,
      withdrawPixKeyType: normalizedPixKeyType,
      idempotencyKey,
      logs: [{ level: 'info', message: 'Withdraw requested', data: { amountGross: amountNum, feeAmount, amountNet } }]
    });


    // Reservar o valor TOTAL (amountGross) do saldo do usuário
    let reserveRes;
    try {
      reserveRes = await applyLedgerDebitReserve(req.app, user._id, tx, amountNum);
    } catch (e) {
      try {
        tx.status = 'failed';
        tx.logs.push({ level: 'error', message: 'Wallet reserve failed', data: { amount: amountNum, reason: e.message } });
        await tx.save();
      } catch (_) {}
      return res.status(400).json({ success: false, message: 'Saldo insuficiente', error: 'INSUFFICIENT_BALANCE' });
    }
    const newBalance = round2(reserveRes?.balance ?? user.walletBalance ?? 0);
    user.walletBalance = newBalance;

    tx.logs.push({ level: 'info', message: 'Wallet debited', data: { newBalance }, at: new Date().toISOString() });
    await tx.save();

    // Creditar taxa de saque ao mediador
    try {
      const mediatorUser = await User.findOne({ email: process.env.MEDIATOR_EMAIL || 'mediador@zenith.com' });
      if (mediatorUser) {
        await runWithTransactionOrFallback(async (session) => {
          const medBefore = round2(mediatorUser.walletBalance || 0);
          const medAfter = round2(medBefore + feeAmount);
          mediatorUser.walletBalance = medAfter;
          await mediatorUser.save({ session });

          const created = await WalletLedger.create([{
            userId: mediatorUser._id,
            txId: tx._id,
            direction: 'credit',
            reason: 'withdraw_fee',
            amount: feeAmount,
            operationId: `withdraw_fee:${tx._id.toString()}`,
            balanceBefore: medBefore,
            balanceAfter: medAfter,
            metadata: { 
              source: 'withdraw', 
              transactionId: tx._id.toString(), 
              userId: user._id.toString(),
              withdrawAmount: amountNum,
              feeAmount: feeAmount,
              netAmount: amountNet
            }
          }], { session });

          // Registrar evento no Mediator
          try {
            const medLedgerDoc = Array.isArray(created) ? created[0] : created;
            await Mediator.create([{
              eventType: 'fee',
              amount: feeAmount,
              currency: 'BRL',
              operationId: `withdraw_fee:${tx._id.toString()}`,
              source: 'ZenithChatApi',
              occurredAt: new Date(),
              reference: {
                walletLedgerId: medLedgerDoc?._id || null,
                transactionId: tx._id,
                asaasTransferId: null
              },
              metadata: { 
                withdrawAmount: amountNum, 
                feeAmount: feeAmount, 
                netAmount: amountNet,
                userId: user._id.toString()
              },
              description: `Taxa de saque (R$ ${feeAmount.toFixed(2)}) creditada ao mediador`
            }], { session });
          } catch (medErr) {
            logger?.warn?.('[WITHDRAW] Failed to log mediator fee event', { error: medErr?.message });
          }
        });

        tx.logs.push({ level: 'info', message: 'Withdraw fee credited to mediator', data: { feeAmount, mediatorBalance: mediatorUser.walletBalance } });
        await tx.save();
      } else {
        logger?.warn?.('[WITHDRAW] Mediator user not found; fee not credited', { transactionId: String(tx._id), feeAmount });
      }
    } catch (feeErr) {
      logger?.error?.('[WITHDRAW] Failed to credit mediator fee', { error: feeErr?.message, transactionId: String(tx._id) });
    }


    afterResponse(res, () => {
      sendWalletNotification(req.app, user._id, {
        title: 'Saque criado',
        body: `Seu saque de R$ ${tx.amountNet.toFixed(2)} foi solicitado e está em processamento.`,
        type: 'wallet_withdraw_created',
        data: { transactionId: tx._id, amount: tx.amountNet }
      });
    });


    // Criar transferência PIX com o valor LÍQUIDO (após taxa)
    let transfer;
    try {
      const externalReference = `wallet_tx_${tx._id.toString()}`;
      transfer = await AsaasService.createPixTransferWithRetry({
        value: amountNet, // Transferir apenas o valor líquido
        pixAddressKey: digits,
        pixAddressKeyType: normalizedPixKeyType,
        description: `Saque usuário ${user._id.toString()} tx ${tx._id.toString()} (líquido: R$ ${amountNet.toFixed(2)}, taxa: R$ ${feeAmount.toFixed(2)})`,
        externalReference
      }, { attempts: 1, delayMs: 800, timeoutMs: 6000 });

      tx.externalReference = externalReference;
      try { await tx.save(); } catch (_) {}
    } catch (err) {
      const status = err?.response?.status || 500;
      const asaasData = err?.response?.data || {};
      const errItem = (asaasData.errors && asaasData.errors[0]) || {};
      const code = errItem.code || asaasData.error;
      const description = errItem.description || err.message;


      if (err?.code === 'ECONNABORTED') {
        try {
          tx.status = 'failed';
          tx.logs.push({ level: 'error', message: 'Withdraw transfer create timeout', data: { message: err.message } });
          await tx.save();
        } catch (_) {}
        return res.status(504).json({
          success: false,
          message: 'Tempo esgotado ao comunicar com o provedor de pagamentos. Tente novamente em instantes.',
          error: 'REQUEST_TIMEOUT',
          docs: 'https://docs.asaas.com/docs/como-testar-funcionalidades'
        });
      }


      try {
        tx.status = 'failed';
        tx.logs.push({ level: 'error', message: 'Withdraw transfer create failed', data: { code, description } });
        await tx.save();
      } catch (_) {}


      try {
        const refunded = await applyLedgerCreditRefund(req.app, user._id, tx);
        if (refunded?.applied) {
          tx.logs.push({ level: 'warn', message: 'Wallet refunded', data: { reason: 'create_failed' }, at: new Date().toISOString() });
          await tx.save();
          afterResponse(res, () => {
            sendWalletNotification(req.app, user._id, {
              title: 'Saque rejeitado',
              body: 'Seu saque foi rejeitado e o valor foi devolvido à sua carteira.',
              type: 'wallet_withdraw_refund',
              data: { transactionId: tx._id, amount: tx.amountNet }
            });
          });
        }
      } catch (_) {}


      let clientMessage = 'Erro ao solicitar saque.';
      let httpStatus = status;
      const descLower = String(description || '').toLowerCase();
      const missingKey = descLower.includes('chave informada não foi encontrada') || (descLower.includes('chave') && (descLower.includes('inválida') || descLower.includes('invalida')));
      if (status === 400 && missingKey) {
        httpStatus = 400;
        clientMessage = 'Chave Pix não encontrada ou inválida no Sandbox. Utilize uma chave Pix de teste conforme a documentação.';
      } else if (String(code) === 'invalid_action') {

        httpStatus = 502;
        clientMessage = 'Operação indisponível no provedor (Sandbox). Verifique se transferências PIX estão habilitadas, se há saldo disponível e se a chave de teste é suportada.';
      } else if (descLower.includes('já solicitado') || descLower.includes('already requested')) {
        httpStatus = 409;
        clientMessage = 'Você já possui um saque pendente em processamento. Aguarde a confirmação antes de solicitar outro.';
      }

      return res.status(httpStatus).json({
        success: false,
        message: clientMessage,
        error: description,
        docs: 'https://docs.asaas.com/docs/como-testar-funcionalidades'
      });
    }

    tx.asaasTransferId = transfer.id;
    tx.logs.push({ level: 'info', message: 'Withdraw transfer created', data: { transferId: transfer.id } });
    await tx.save();


    let transferStatus = 'PENDING';
    try {
      const t = await AsaasService.getTransferWithTimeout(transfer.id, 3500);
      transferStatus = String(t?.status || 'PENDING').toUpperCase();
      if (transferStatus.includes('DONE') || transferStatus.includes('CONFIRMED') || transferStatus === 'COMPLETED' || transferStatus === 'PAID') {
        tx.status = 'withdraw_completed';
        tx.logs.push({ level: 'info', message: 'Withdraw transfer confirmed', data: { transferId: transfer.id, status: transferStatus } });
        await tx.save();


        afterResponse(res, () => {
          sendBalanceUpdateEvent(req.app, user._id, {
            userId: user._id.toString(),
            transactionId: tx._id.toString(),
            status: tx.status,
            balance: user.walletBalance,
            amountGross: tx.amountGross,
            feeAmount: tx.feeAmount,
            amountNet: tx.amountNet,
            timestamp: new Date().toISOString()
          });
          sendWalletNotification(req.app, user._id, {
            title: 'Saque realizado',
            body: `R$ ${tx.amountNet.toFixed(2)} enviados via Pix`,
            type: 'wallet_withdraw',
            data: { transactionId: tx._id, amount: tx.amountNet }
          });
        });


        try {
          const u = await User.findById(user._id);
          if (u && !u.pixKeyLocked) {
            u.pixKeyLocked = true;
            if (!u.pixKeyFirstWithdrawAt) u.pixKeyFirstWithdrawAt = new Date();
            await u.save();
          }
        } catch (_) {}

        return res.json({ success: true, data: { transactionId: tx._id, transferId: transfer.id, transferStatus, newBalance: user.walletBalance } });
      } else if (transferStatus.includes('FAILED') || transferStatus.includes('CANCELLED') || transferStatus.includes('REFUSED')) {

        tx.status = 'failed';
        tx.logs.push({ level: 'error', message: 'Withdraw transfer failed (immediate status check)', data: { transferId: transfer.id, status: transferStatus } });
        try {
          const refunded = await applyLedgerCreditRefund(req.app, user._id, tx);
          if (refunded?.applied) {
            tx.logs.push({ level: 'warn', message: 'Wallet refunded', data: { reason: 'immediate_failed' }, at: new Date().toISOString() });
          }
        } catch (_) {}
        await tx.save();
        return res.json({ success: true, data: { transactionId: tx._id, transferId: transfer.id, transferStatus, newBalance: user.walletBalance } });
      } else {

        await tx.save();
        return res.json({ success: true, data: { transactionId: tx._id, transferId: transfer.id, transferStatus, newBalance: user.walletBalance } });
      }
    } catch (stErr) {
      tx.logs.push({ level: 'warn', message: 'Withdraw transfer status check failed', data: { transferId: transfer.id, error: stErr.message } });
      await tx.save();
      return res.json({ success: true, data: { transactionId: tx._id, transferId: transfer.id, transferStatus: 'UNKNOWN', newBalance: user.walletBalance } });
    }
  } catch (error) {
    logger.error('Wallet withdraw error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao solicitar saque', error: error.message });
  }
});


// 🛡️ GET /wallet/withdraw/status - Verificar status de bloqueio por tentativas falhas
router.get('/withdraw/status', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const oneHourAgo = new Date(Date.now() - BLOCK_DURATION_MS);
    
    // Contar tentativas falhas na última hora
    const failedAttempts = await WalletTransaction.countDocuments({
      userId,
      type: 'withdraw',
      status: 'failed',
      createdAt: { $gte: oneHourAgo },
      'logs.message': { $in: ['Withdraw transfer create failed', 'Wallet reserve failed'] }
    });
    
    // Se não está bloqueado
    if (failedAttempts < MAX_FAILED_ATTEMPTS) {
      return res.json({
        success: true,
        data: {
          blocked: false,
          failedAttempts,
          maxAttempts: MAX_FAILED_ATTEMPTS,
          remainingAttempts: MAX_FAILED_ATTEMPTS - failedAttempts
        }
      });
    }
    
    // Está bloqueado: calcular tempo restante
    const oldestFailed = await WalletTransaction.findOne({
      userId,
      type: 'withdraw',
      status: 'failed',
      createdAt: { $gte: oneHourAgo }
    }).sort({ createdAt: 1 }).select('createdAt');
    
    if (!oldestFailed) {
      // Não deveria acontecer, mas retorna desbloqueado por segurança
      return res.json({
        success: true,
        data: { blocked: false, failedAttempts: 0 }
      });
    }
    
    const blockUntil = new Date(oldestFailed.createdAt.getTime() + BLOCK_DURATION_MS);
    const remainingMs = blockUntil.getTime() - Date.now();
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    
    // Se o bloqueio já expirou
    if (remainingMs <= 0) {
      return res.json({
        success: true,
        data: { blocked: false, failedAttempts: 0 }
      });
    }
    
    return res.json({
      success: true,
      data: {
        blocked: true,
        failedAttempts,
        maxAttempts: MAX_FAILED_ATTEMPTS,
        blockUntil: blockUntil.toISOString(),
        remainingMinutes
      }
    });
  } catch (error) {
    logger.error('[WITHDRAW] Error checking withdraw status', { error: error.message });
    return res.status(500).json({ 
      success: false, 
      message: 'Erro ao verificar status de saque', 
      error: error.message 
    });
  }
});

router.post('/withdraw/sync', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const recon = await reconcilePendingWithdrawsForUser(req.app, userId, { limit: 50, timeoutMs: 4500 });

    handleWithdrawTimeoutsForUser(req.app, userId).catch(() => {});

    await expireStalePendingWithdrawsForUser(req.app, userId);
    const pendingCount = await WalletTransaction.countDocuments({
      userId,
      type: 'withdraw',
      status: { $in: ['withdraw_pending', 'processing'] }
    });
    const today = startOfToday();
    const todayCount = await WalletTransaction.countDocuments({
      userId,
      type: 'withdraw',
      createdAt: { $gte: today },
      status: { $in: ['withdraw_pending', 'processing', 'withdraw_completed'] }
    });
    return res.json({ success: true, data: { pendingCount, todayCount, nextResetAt: startOfTomorrow().toISOString(), reconciliation: recon } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao sincronizar saques', error: error.message });
  }
});


// GET /wallet/escrow - Retorna saldo bloqueado em escrow
router.get('/escrow', auth, async (req, res) => {
  try {
    const Purchase = require('../models/Purchase');
    const AcceptedProposal = require('../models/AcceptedProposal');
    
    let totalEscrow = 0;
    let itemCount = 0;
    
    // 1. Buscar PURCHASES onde usuário é VENDEDOR com status em escrow
    const purchases = await Purchase.find({
      sellerId: req.user._id,
      status: { $in: ['escrow_reserved', 'shipped', 'delivered'] }
    }).select('sellerReceives status');
    
    for (const purchase of purchases) {
      totalEscrow += purchase.sellerReceives || 0;
      itemCount++;
    }
    
    // 2. Buscar PROPOSTAS ACEITAS onde usuário é BOOSTER (prestador) ainda ativas
    const proposals = await AcceptedProposal.find({
      'booster.userid': req.user._id,
      status: 'active'
    }).select('price');
    
    for (const proposal of proposals) {
      totalEscrow += proposal.price || 0;
      itemCount++;
    }
    
    // Enviar atualização via WebSocket em tempo real
    const user = await User.findById(req.user._id).select('walletBalance');
    await sendEscrowUpdateEvent(req.app, req.user._id, totalEscrow, user?.walletBalance);
    
    return res.json({
      success: true,
      data: {
        escrowBalance: round2(totalEscrow),
        activeAgreements: itemCount,
        currency: 'BRL',
        breakdown: {
          purchases: purchases.length,
          proposals: proposals.length
        }
      }
    });
  } catch (error) {
    logger.error('Erro ao buscar saldo em escrow:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao obter saldo bloqueado'
    });
  }
});

module.exports = router;
module.exports.calculateAndSendEscrowUpdate = calculateAndSendEscrowUpdate;

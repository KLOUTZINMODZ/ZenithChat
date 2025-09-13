const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Purchase = require('../models/Purchase');
const WalletLedger = require('../models/WalletLedger');

function round2(v) { return Math.round(Number(v) * 100) / 100; }
function onlyDigits(v) { return String(v || '').replace(/\D/g, ''); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').toLowerCase()); }
function isValidCPF(cpf) {
  const d = onlyDigits(cpf);
  if (d.length !== 11 || /^([0-9])\1{10}$/.test(d)) return false;
  let sum = 0, rest;
  for (let i = 1; i <= 9; i++) sum += parseInt(d.substring(i - 1, i)) * (11 - i);
  rest = (sum * 10) % 11; if (rest === 10 || rest === 11) rest = 0; if (rest !== parseInt(d.substring(9, 10))) return false;
  sum = 0; for (let i = 1; i <= 10; i++) sum += parseInt(d.substring(i - 1, i)) * (12 - i);
  rest = (sum * 10) % 11; if (rest === 10 || rest === 11) rest = 0; return rest === parseInt(d.substring(10, 11));
}
function getAge(birthDate) {
  try { const d = new Date(birthDate); const diff = Date.now() - d.getTime(); const a = new Date(diff); return Math.abs(a.getUTCFullYear() - 1970); } catch { return 0; }
}

async function runTx(executor) {
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const res = await executor(session);
    await session.commitTransaction();
    session.endSession();
    return res;
  } catch (err) {
    if (session) { try { await session.abortTransaction(); } catch (_) {} session.endSession(); }
    return executor(null);
  }
}

async function sendBalanceUpdate(app, userId) {
  try {
    const u = await User.findById(userId);
    const notificationService = app?.locals?.notificationService;
    if (notificationService) {
      notificationService.sendToUser(String(userId), {
        type: 'wallet:balance_updated',
        data: { userId: String(userId), balance: round2(u?.walletBalance || 0), timestamp: new Date().toISOString() }
      });
    }
  } catch (_) {}
}

async function getOrCreateConversation(buyerId, sellerId, metadata) {
  const p = [buyerId.toString(), sellerId.toString()].sort();
  let conv = await Conversation.findOne({
    participants: { $all: p, $size: 2 },
    'metadata.purchaseId': metadata.purchaseId
  });
  if (!conv) {
    let meta = metadata instanceof Map ? metadata : new Map(Object.entries(metadata || {}));
    conv = await Conversation.create({ participants: p, type: 'direct', metadata: meta });
  }
  return conv;
}

// POST /api/purchases/initiate
router.post('/initiate', auth, async (req, res) => {
  try {
    const buyerId = req.user._id;
    const { itemId, price, sellerUserId, itemTitle, itemImage, buyerInfo } = req.body || {};

    if (!itemId || !sellerUserId || !price) {
      return res.status(400).json({ success: false, message: 'Parâmetros obrigatórios ausentes (itemId, sellerUserId, price)' });
    }
    if (!buyerInfo || !buyerInfo.fullName || !buyerInfo.cpf || !buyerInfo.birthDate || !buyerInfo.email) {
      return res.status(400).json({ success: false, message: 'Dados do comprador incompletos' });
    }

    const fullName = String(buyerInfo.fullName || '').trim();
    const cpf = onlyDigits(buyerInfo.cpf);
    const birthDate = new Date(buyerInfo.birthDate);
    const email = String(buyerInfo.email || '').trim();

    if (fullName.length < 5) return res.status(400).json({ success: false, message: 'Nome completo inválido' });
    if (!isValidCPF(cpf)) return res.status(400).json({ success: false, message: 'CPF inválido' });
    if (!isValidEmail(email)) return res.status(400).json({ success: false, message: 'E-mail inválido' });
    if (getAge(birthDate) < 18) return res.status(400).json({ success: false, message: 'Idade mínima para compra é 18 anos' });

    const buyer = await User.findById(buyerId);
    if (!buyer) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    if (buyer.walletBalance < Number(price)) return res.status(400).json({ success: false, message: 'Saldo insuficiente' });

    if (buyer.cpfCnpj && buyer.cpfCnpj !== cpf) {
      return res.status(409).json({ success: false, message: 'CPF em conflito com o já vinculado à conta.' });
    }
    if (buyer.legalName && buyer.legalName !== fullName) {
      return res.status(409).json({ success: false, message: 'Nome completo em conflito com o já vinculado à conta.' });
    }
    if (buyer.birthDate) {
      const stored = new Date(buyer.birthDate).toISOString().slice(0,10);
      const incoming = birthDate.toISOString().slice(0,10);
      if (stored !== incoming) {
        return res.status(409).json({ success: false, message: 'Data de nascimento em conflito com a já vinculada à conta.' });
      }
    }
    if (buyer.email && buyer.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(409).json({ success: false, message: 'E-mail informado difere do e-mail da conta.' });
    }

    const feePercent = 5;
    const platformFee = round2((Number(price) * feePercent) / 100);
    const sellerReceives = round2(Number(price) - platformFee);

    const purchase = await runTx(async (session) => {
      let p = await Purchase.create([{
        buyerId, sellerId: sellerUserId, itemId, price: Number(price), feePercent, feeAmount: platformFee, sellerReceives,
        status: 'initiated',
        buyerInfo: { fullName, cpf, birthDate, email },
        logs: [{ level: 'info', message: 'Purchase initiated' }]
      }], { session });
      p = p[0];

      const before = round2(buyer.walletBalance || 0);
      const after = round2(before - Number(price));
      buyer.walletBalance = after;
      if (!buyer.cpfCnpj) buyer.cpfCnpj = cpf;
      if (!buyer.legalName) buyer.legalName = fullName;
      if (!buyer.birthDate) buyer.birthDate = birthDate;
      await buyer.save({ session });

      await WalletLedger.create([{
        userId: buyerId,
        txId: null,
        direction: 'debit',
        reason: 'purchase_reserve',
        amount: Number(price),
        operationId: `purchase_reserve:${p._id.toString()}`,
        balanceBefore: before,
        balanceAfter: after,
        metadata: { source: 'purchase', purchaseId: p._id.toString(), itemId }
      }], { session });

      p.status = 'escrow_reserved';
      p.escrowReservedAt = new Date();
      await p.save({ session });

      // cpf already ensured above

      return p;
    });

    // create or fetch conversation
    const conv = await getOrCreateConversation(buyerId, sellerUserId, { purchaseId: purchase._id.toString(), marketplaceItemId: itemId, context: 'marketplace_purchase' });
    purchase.conversationId = conv._id;
    await purchase.save();

    await sendBalanceUpdate(req.app, buyerId);

    try {
      const ns = req.app?.locals?.notificationService;
      if (ns) {
        await ns.sendNotification(String(buyerId), {
          type: 'purchase:initiated',
          title: 'Compra iniciada',
          message: `Você iniciou a compra de ${itemTitle || 'um item'}.`,
          data: { purchaseId: purchase._id, conversationId: conv._id, itemId }
        });
        await ns.sendNotification(String(sellerUserId), {
          type: 'purchase:new',
          title: 'Novo pedido',
          message: `Um comprador iniciou a compra de ${itemTitle || 'seu item'}.`,
          data: { purchaseId: purchase._id, conversationId: conv._id, itemId }
        });
      }
    } catch (_) {}

    return res.status(201).json({ success: true, message: 'Compra iniciada e valor bloqueado em escrow', data: { purchaseId: purchase._id, conversationId: conv._id } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao iniciar compra', error: error.message });
  }
});

// POST /api/purchases/ship
router.post('/:purchaseId/ship', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const sellerId = req.user._id;
    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Compra não encontrada' });
    if (purchase.sellerId.toString() !== sellerId.toString()) return res.status(403).json({ success: false, message: 'Acesso negado' });
    if (!['escrow_reserved', 'initiated'].includes(purchase.status)) return res.status(400).json({ success: false, message: 'Compra não pode ser marcada como enviada' });

    purchase.status = 'shipped';
    purchase.shippedAt = new Date();
    const auto = new Date(); auto.setDate(auto.getDate() + 7);
    purchase.autoReleaseAt = auto;
    purchase.logs.push({ level: 'info', message: 'Seller marked as shipped', data: { autoReleaseAt: auto } });
    await purchase.save();

    try { const ns = req.app?.locals?.notificationService; if (ns) ns.sendNotification(String(purchase.buyerId), { type: 'purchase:shipped', title: 'Pedido enviado', message: 'O vendedor confirmou o envio do item.', data: { purchaseId } }); } catch (_) {}

    return res.json({ success: true, message: 'Envio confirmado. Escrow será liberado automaticamente em 7 dias se o comprador não confirmar.', data: { autoReleaseAt: purchase.autoReleaseAt } });
  } catch (error) { return res.status(500).json({ success: false, message: 'Erro ao marcar envio', error: error.message }); }
});

// POST /api/purchases/:purchaseId/confirm
router.post('/:purchaseId/confirm', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const buyerId = req.user._id;
    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Compra não encontrada' });
    if (purchase.buyerId.toString() !== buyerId.toString()) return res.status(403).json({ success: false, message: 'Acesso negado' });
    if (!['shipped', 'delivered', 'escrow_reserved'].includes(purchase.status)) return res.status(400).json({ success: false, message: 'Compra não está apta para confirmação' });

    await runTx(async (session) => {
      const seller = await User.findById(purchase.sellerId).session(session);
      const before = round2(seller.walletBalance || 0);
      const after = round2(before + Number(purchase.sellerReceives));
      seller.walletBalance = after;
      await seller.save({ session });
      await WalletLedger.create([{
        userId: purchase.sellerId,
        txId: null,
        direction: 'credit',
        reason: 'purchase_release',
        amount: Number(purchase.sellerReceives),
        operationId: `purchase_release:${purchase._id.toString()}`,
        balanceBefore: before,
        balanceAfter: after,
        metadata: { source: 'purchase', purchaseId: purchase._id.toString(), itemId: purchase.itemId }
      }], { session });

      purchase.status = 'completed';
      purchase.deliveredAt = new Date();
      purchase.logs.push({ level: 'info', message: 'Buyer confirmed delivery. Funds released to seller.' });
      await purchase.save({ session });
    });

    await sendBalanceUpdate(req.app, purchase.sellerId);

    return res.json({ success: true, message: 'Recebimento confirmado. Valores liberados ao vendedor.' });
  } catch (error) { return res.status(500).json({ success: false, message: 'Erro ao confirmar recebimento', error: error.message }); }
});

// POST /api/purchases/:purchaseId/cancel
router.post('/:purchaseId/cancel', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const userId = req.user._id;
    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Compra não encontrada' });
    const isBuyer = purchase.buyerId.toString() === userId.toString();
    const isSeller = purchase.sellerId.toString() === userId.toString();
    if (!isBuyer && !isSeller) return res.status(403).json({ success: false, message: 'Acesso negado' });
    if (!['initiated', 'escrow_reserved'].includes(purchase.status)) return res.status(400).json({ success: false, message: 'Compra não pode ser cancelada neste status' });

    await runTx(async (session) => {
      const buyer = await User.findById(purchase.buyerId).session(session);
      const before = round2(buyer.walletBalance || 0);
      const after = round2(before + Number(purchase.price));
      buyer.walletBalance = after;
      await buyer.save({ session });
      await WalletLedger.create([{
        userId: purchase.buyerId,
        txId: null,
        direction: 'credit',
        reason: 'purchase_refund',
        amount: Number(purchase.price),
        operationId: `purchase_refund:${purchase._id.toString()}`,
        balanceBefore: before,
        balanceAfter: after,
        metadata: { source: 'purchase', purchaseId: purchase._id.toString(), itemId: purchase.itemId }
      }], { session });
      purchase.status = 'cancelled';
      purchase.cancelledAt = new Date();
      purchase.logs.push({ level: 'warn', message: 'Purchase cancelled and refunded' });
      await purchase.save({ session });
    });

    await sendBalanceUpdate(req.app, purchase.buyerId);

    return res.json({ success: true, message: 'Compra cancelada e valor estornado' });
  } catch (error) { return res.status(500).json({ success: false, message: 'Erro ao cancelar compra', error: error.message }); }
});

// Internal auto-release job trigger (can be called by cron)
router.post('/auto-release/run', auth, async (req, res) => {
  try {
    const now = new Date();
    const candidates = await Purchase.find({ status: 'shipped', autoReleaseAt: { $lte: now } }).limit(50);
    let released = 0;
    for (const p of candidates) {
      try {
        await runTx(async (session) => {
          const seller = await User.findById(p.sellerId).session(session);
          const before = round2(seller.walletBalance || 0);
          const after = round2(before + Number(p.sellerReceives));
          seller.walletBalance = after;
          await seller.save({ session });
          await WalletLedger.create([{
            userId: p.sellerId,
            txId: null,
            direction: 'credit',
            reason: 'purchase_release',
            amount: Number(p.sellerReceives),
            operationId: `purchase_release:${p._id.toString()}`,
            balanceBefore: before,
            balanceAfter: after,
            metadata: { source: 'purchase', auto: true, purchaseId: p._id.toString(), itemId: p.itemId }
          }], { session });
          p.status = 'completed';
          p.logs.push({ level: 'info', message: 'Auto-release after 7 days from shipped' });
          await p.save({ session });
        });
        released++;
        await sendBalanceUpdate(req.app, p.sellerId);
      } catch (_) {}
    }
    return res.json({ success: true, data: { released } });
  } catch (error) { return res.status(500).json({ success: false, message: 'Erro no auto-release', error: error.message }); }
});

module.exports = router;

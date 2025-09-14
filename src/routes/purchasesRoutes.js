const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Purchase = require('../models/Purchase');
const WalletLedger = require('../models/WalletLedger');
const MarketItem = require('../models/MarketItem');
const cache = require('../services/GlobalCache');
const logger = require('../utils/logger');

// Robustly extract a string ObjectId from different legacy shapes
function safeId(v) {
  try {
    if (!v) return null;
    // If already a valid ObjectId or string
    if (mongoose.Types.ObjectId.isValid(v)) return String(v);
    if (typeof v === 'string' && mongoose.Types.ObjectId.isValid(v)) return v;
    if (typeof v === 'object') {
      if (v._id && mongoose.Types.ObjectId.isValid(v._id)) return String(v._id);
      if (v.$oid && typeof v.$oid === 'string' && mongoose.Types.ObjectId.isValid(v.$oid)) return v.$oid;
      // Some drivers expose toHexString
      if (typeof v.toHexString === 'function') return v.toHexString();
    }
  } catch (_) {}
  return null;
}

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

// Helper: ensure conversation marketplace.statusCompra is updated within the same DB session/transaction
async function updateConversationMarketplaceStatus(session, purchase, status) {
  try {
    if (!purchase?.conversationId) return;
    await Conversation.findByIdAndUpdate(
      purchase.conversationId,
      { $set: { 'marketplace.statusCompra': status, updatedAt: new Date() } },
      session ? { session } : {}
    );
  } catch (e) {
    try { logger?.warn?.('[PURCHASES] Failed to update conversation marketplace status', { purchaseId: String(purchase?._id), status, error: e?.message }); } catch (_) {}
  }
}

// Helper: emit consistent WS events and refresh conversations for both participants
async function emitMarketplaceStatusChanged(app, purchase, status) {
  try {
    const ws = app.get('webSocketServer');
    const participants = [purchase?.buyerId?.toString?.(), purchase?.sellerId?.toString?.()].filter(Boolean);
    if (ws) {
      for (const uid of participants) {
        ws.sendToUser(uid, {
          type: 'marketplace:status_changed',
          data: {
            conversationId: purchase?.conversationId?.toString?.() || purchase?.conversationId,
            purchaseId: purchase?._id?.toString?.() || purchase?._id,
            status,
            shippedAt: purchase?.shippedAt || null,
            deliveredAt: purchase?.deliveredAt || null,
            autoReleaseAt: purchase?.autoReleaseAt || null,
            timestamp: new Date().toISOString()
          }
        });
      }
      if (ws.conversationHandler) {
        for (const uid of participants) {
          await ws.conversationHandler.sendConversationsUpdate(uid);
        }
      }
    }
    participants.forEach(pid => cache.invalidateUserCache(pid));
  } catch (_) {}
}

async function getOrCreateConversation(buyerId, sellerId, metadata) {
  const unique = Array.from(new Set([buyerId.toString(), sellerId.toString()])).sort();
  if (unique.length < 2) {
    throw new Error('Participants must be distinct');
  }
  let conv = await Conversation.findOne({
    participants: { $all: unique, $size: unique.length },
    'metadata.purchaseId': metadata.purchaseId
  });
  if (!conv) {
    let meta = metadata instanceof Map ? metadata : new Map(Object.entries(metadata || {}));
    try {
      conv = await Conversation.create({ participants: unique, type: 'marketplace', metadata: meta });
    } catch (err) {
      // Idempotency guard: if another request created it, refetch
      if (err && err.code === 11000) {
        conv = await Conversation.findOne({ 'metadata.purchaseId': metadata.purchaseId });
      } else {
        throw err;
      }
    }
  }
  return conv;
}

// Simple diagnostics (no auth) to confirm router is mounted
router.get('/', (req, res) => {
  res.json({ success: true, message: 'Purchases router online' });
});

// Healthcheck: GET /api/purchases/health
router.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

// POST /api/purchases/initiate
router.post('/initiate', auth, async (req, res) => {
  try {
    const buyerId = req.user._id;
    const { itemId, price, sellerUserId, itemTitle, itemImage, buyerInfo } = req.body || {};

    if (!itemId) {
      return res.status(400).json({ success: false, message: 'Parâmetros obrigatórios ausentes (itemId)' });
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

    // Fetch item to derive true seller and price (lean to preserve all fields like sellerId from main API)
    const itemDoc = await MarketItem.findById(itemId).lean();
    if (!itemDoc) return res.status(404).json({ success: false, message: 'Item não encontrado' });
    // Validate seller id on the item (support legacy shapes). Prefer sellerId (main API canonical), then userId, then others
    let sellerUserIdFromItem = safeId(itemDoc.sellerId)
      || safeId(itemDoc.userId)
      || safeId(itemDoc.ownerId)
      || safeId(itemDoc.user)
      || safeId(itemDoc.createdBy);
    if (!sellerUserIdFromItem) {
      try { logger.warn('[PURCHASES] Invalid item seller id for initiate', { itemId, sellerId: itemDoc?.sellerId, userIdField: itemDoc?.userId, ownerId: itemDoc?.ownerId }); } catch (_) {}
      return res.status(400).json({ success: false, message: 'Item inválido: vendedor não configurado ou inválido' });
    }

    // Optional status guard: if main API provided status and it's not active, block purchase
    if (typeof itemDoc.status === 'string' && itemDoc.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Item indisponível para compra' });
    }
    // Validate price
    const priceUsed = Number(itemDoc.price ?? price);
    if (!Number.isFinite(priceUsed) || priceUsed <= 0) {
      return res.status(400).json({ success: false, message: 'Preço inválido para a compra' });
    }

    const buyer = await User.findById(buyerId);
    if (!buyer) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    if (buyer.walletBalance < Number(priceUsed)) return res.status(400).json({ success: false, message: 'Saldo insuficiente' });

    // Validate seller
    const seller = await User.findById(sellerUserIdFromItem);
    if (!seller) return res.status(404).json({ success: false, message: 'Vendedor não encontrado' });
    if (buyerId.toString() === seller._id.toString()) {
      return res.status(400).json({ success: false, message: 'Você não pode comprar seu próprio item.' });
    }

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
    const platformFee = round2((Number(priceUsed) * feePercent) / 100);
    const sellerReceives = round2(Number(priceUsed) - platformFee);

    const purchase = await runTx(async (session) => {
      let p = await Purchase.create([{
        buyerId, sellerId: sellerUserIdFromItem, itemId, price: Number(priceUsed), feePercent, feeAmount: platformFee, sellerReceives,
        status: 'initiated',
        buyerInfo: { fullName, cpf, birthDate, email },
        logs: [{ level: 'info', message: 'Purchase initiated' }]
      }], { session });
      p = p[0];

      const before = round2(buyer.walletBalance || 0);
      const after = round2(before - Number(priceUsed));
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
        amount: Number(priceUsed),
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
    const conv = await getOrCreateConversation(buyerId, sellerUserIdFromItem, { purchaseId: purchase._id.toString(), marketplaceItemId: itemId, context: 'marketplace_purchase' });
    purchase.conversationId = conv._id;
    await purchase.save();

    // Atualiza conversa para modo marketplace e preenche subdocumento marketplace
    try {
      const seller = await User.findById(sellerUserIdFromItem);
      // Derive item summary safely
      const itemTitleUsed = itemTitle || (typeof itemDoc?.title === 'string' ? itemDoc.title : undefined) || '';
      let itemImageUsed = itemImage || (typeof itemDoc?.image === 'string' ? itemDoc.image : undefined) || '';
      if (!itemImageUsed && Array.isArray(itemDoc?.images) && itemDoc.images.length > 0) {
        itemImageUsed = String(itemDoc.images[0]);
      }

      conv.type = 'marketplace';
      conv.marketplace = {
        buyer: {
          userid: buyerId,
          name: buyer.name || buyer.legalName || buyer.username || null,
          email: buyer.email || null,
          avatar: buyer.avatar || buyer.profileImage || null
        },
        seller: {
          userid: seller?._id || sellerUserIdFromItem,
          name: seller?.name || seller?.legalName || seller?.username || null,
          email: seller?.email || null,
          avatar: seller?.avatar || seller?.profileImage || null
        },
        nomeRegistrado: String(fullName || buyer.legalName || buyer.name || ''),
        purchaseId: purchase._id,
        marketplaceItemId: itemId,
        statusCompra: purchase.status,
        price: Number(priceUsed),
        currency: 'BRL',
        itemTitle: itemTitleUsed,
        itemImage: itemImageUsed,
        purchaseDate: purchase.escrowReservedAt || new Date()
      };

      // Compatibilidade: client=buyer, booster=seller (sempre sobrescrever com valores computados)
      conv.client = {
        userid: buyerId,
        name: buyer.name || buyer.legalName || buyer.username || 'Cliente',
        avatar: buyer.avatar || buyer.profileImage || null
      };
      if (seller) {
        conv.booster = {
          userid: seller._id,
          name: seller.name || seller.legalName || seller.username || 'Vendedor',
          avatar: seller.avatar || seller.profileImage || null
        };
      } else {
        conv.booster = { userid: sellerUserIdFromItem, name: 'Vendedor', avatar: null };
      }

      // Garante metadados
      try {
        if (!(conv.metadata instanceof Map)) {
          conv.metadata = new Map(Object.entries(conv.metadata || {}));
        }
      } catch (_) {
        conv.metadata = new Map();
      }
      conv.metadata.set('purchaseId', purchase._id.toString());
      conv.metadata.set('marketplaceItemId', String(itemId));
      conv.metadata.set('context', 'marketplace_purchase');
      conv.metadata.set('statusCompra', purchase.status);
      conv.metadata.set('price', Number(priceUsed));
      conv.metadata.set('currency', 'BRL');
      if (itemTitleUsed) conv.metadata.set('itemTitle', itemTitleUsed);
      if (itemImageUsed) conv.metadata.set('itemImage', itemImageUsed);
      conv.metadata.set('purchaseDate', (purchase.escrowReservedAt || new Date()).toISOString());

      await conv.save();
    } catch (convErr) {
      console.error('[PURCHASES] Failed to update conversation as marketplace:', convErr);
    }

    await sendBalanceUpdate(req.app, buyerId);

    // Proactively update conversations list for both participants and clear caches
    try {
      const ws = req.app.get('webSocketServer');
      const participants = [buyerId?.toString(), sellerUserIdFromItem?.toString()].filter(Boolean);
      if (ws?.conversationHandler) {
        for (const uid of participants) {
          await ws.conversationHandler.sendConversationsUpdate(uid);
        }
      }
      participants.forEach(pid => cache.invalidateUserCache(pid));
    } catch (_) {}

    try {
      const ns = req.app?.locals?.notificationService;
      if (ns) {
        await ns.sendNotification(String(buyerId), {
          type: 'purchase:initiated',
          title: 'Compra iniciada',
          message: `Você iniciou a compra de ${itemTitle || 'um item'}.`,
          data: { purchaseId: purchase._id, conversationId: conv._id, itemId }
        });
        await ns.sendNotification(String(sellerUserIdFromItem), {
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
    let purchase = await Purchase.findById(purchaseId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Compra não encontrada' });
    if (purchase.sellerId.toString() !== sellerId.toString()) return res.status(403).json({ success: false, message: 'Acesso negado' });

    // Idempotência: se já está shipped/completed/cancelled, não processar novamente
    if (['shipped', 'completed', 'cancelled'].includes(String(purchase.status))) {
      return res.json({ success: true, message: 'Status já atualizado anteriormente', data: { status: purchase.status, autoReleaseAt: purchase.autoReleaseAt } });
    }
    if (!['escrow_reserved', 'initiated'].includes(purchase.status)) {
      return res.status(400).json({ success: false, message: 'Compra não pode ser marcada como enviada' });
    }

    await runTx(async (session) => {
      purchase.status = 'shipped';
      purchase.shippedAt = new Date();
      const auto = new Date(); auto.setDate(auto.getDate() + 7);
      purchase.autoReleaseAt = auto;
      purchase.logs.push({ level: 'info', message: 'Seller marked as shipped', data: { autoReleaseAt: auto } });
      await purchase.save({ session });

      await updateConversationMarketplaceStatus(session, purchase, 'shipped');
    });

    await emitMarketplaceStatusChanged(req.app, purchase, 'shipped');

    try {
      const ns = req.app?.locals?.notificationService;
      if (ns) ns.sendNotification(String(purchase.buyerId), { type: 'purchase:shipped', title: 'Pedido enviado', message: 'O vendedor confirmou o envio do item.', data: { purchaseId } });
    } catch (_) {}

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

      // Buyer settlement ledger (amount 0) to appear in history without changing balance
      try {
        const buyer = await User.findById(purchase.buyerId).session(session);
        const buyerBefore = round2(buyer?.walletBalance || 0);
        await WalletLedger.create([{
          userId: purchase.buyerId,
          txId: null,
          direction: 'debit',
          reason: 'purchase_settle',
          amount: 0,
          operationId: `purchase_settle:${purchase._id.toString()}`,
          balanceBefore: buyerBefore,
          balanceAfter: buyerBefore,
          metadata: { source: 'purchase', purchaseId: purchase._id.toString(), itemId: purchase.itemId }
        }], { session });
      } catch (_) {}

      purchase.status = 'completed';
      purchase.deliveredAt = new Date();
      purchase.logs.push({ level: 'info', message: 'Buyer confirmed delivery. Funds released to seller.' });
      await purchase.save({ session });

      await updateConversationMarketplaceStatus(session, purchase, 'completed');
    });

    await emitMarketplaceStatusChanged(req.app, purchase, 'completed');

    await sendBalanceUpdate(req.app, purchase.sellerId);
    // Also notify buyer so their UI can refresh transaction history
    await sendBalanceUpdate(req.app, purchase.buyerId);

    try {
      const ns = req.app?.locals?.notificationService;
      if (ns) {
        ns.sendNotification(String(purchase.sellerId), { type: 'purchase:completed', title: 'Pagamento liberado', message: 'O comprador confirmou o recebimento. Valor liberado na sua carteira.', data: { purchaseId } });
        ns.sendNotification(String(purchase.buyerId), { type: 'purchase:completed', title: 'Pedido concluído', message: 'Obrigado por confirmar. Pedido concluído com sucesso.', data: { purchaseId } });
      }
    } catch (_) {}

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

      await updateConversationMarketplaceStatus(session, purchase, 'cancelled');
    });
    await emitMarketplaceStatusChanged(req.app, purchase, 'cancelled');

    await sendBalanceUpdate(req.app, purchase.buyerId);

    try {
      const ns = req.app?.locals?.notificationService;
      if (ns) {
        ns.sendNotification(String(purchase.buyerId), { type: 'purchase:cancelled', title: 'Compra cancelada', message: 'Seu pagamento foi estornado.', data: { purchaseId } });
        ns.sendNotification(String(purchase.sellerId), { type: 'purchase:cancelled', title: 'Compra cancelada', message: 'O pedido foi cancelado pelo comprador/vendedor.', data: { purchaseId } });
      }
    } catch (_) {}

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

          await updateConversationMarketplaceStatus(session, p, 'completed');
        });
        released++;
        await sendBalanceUpdate(req.app, p.sellerId);
        await emitMarketplaceStatusChanged(req.app, p, 'completed');
      } catch (_) {}
    }
    return res.json({ success: true, data: { released } });
  } catch (error) { return res.status(500).json({ success: false, message: 'Erro no auto-release', error: error.message }); }
});

// GET /api/purchases/:purchaseId - summary for frontend (marketplace chat context)
router.get('/:purchaseId', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Compra não encontrada' });
    }

    // Only participants can view
    const userId = req.user?._id || req.user?.id;
    const isParticipant = [purchase.buyerId?.toString(), purchase.sellerId?.toString()].includes(userId?.toString());
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    const data = {
      purchaseId: purchase._id?.toString(),
      buyerId: purchase.buyerId?.toString(),
      sellerId: purchase.sellerId?.toString(),
      itemId: purchase.itemId?.toString?.() || purchase.itemId,
      price: Number(purchase.price) || 0,
      status: purchase.status,
      feePercent: purchase.feePercent,
      feeAmount: purchase.feeAmount,
      sellerReceives: purchase.sellerReceives,
      conversationId: purchase.conversationId?.toString?.() || purchase.conversationId,
      escrowReservedAt: purchase.escrowReservedAt,
      shippedAt: purchase.shippedAt,
      deliveredAt: purchase.deliveredAt,
      autoReleaseAt: purchase.autoReleaseAt
    };

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar compra', error: error.message });
  }
});

module.exports = router;

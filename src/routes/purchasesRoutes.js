const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Purchase = require('../models/Purchase');
const WalletLedger = require('../models/WalletLedger');
const Mediator = require('../models/Mediator');
const MarketItem = require('../models/MarketItem');
const Report = require('../models/Report');
const Review = require('../models/Review');
const Agreement = require('../models/Agreement');
const BoostingRequest = require('../models/BoostingRequest');
const BoostingOrder = require('../models/BoostingOrder');
const { calculateAndSendEscrowUpdate } = require('./walletRoutes');
const cache = require('../services/GlobalCache');
const logger = require('../utils/logger');
const axios = require('axios');
const { sendSupportTicketNotification } = require('../services/TelegramService');
const { checkProhibitedContent } = require('../utils/contentFilter');

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
  } catch (_) { }
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
    if (session) { try { await session.abortTransaction(); } catch (_) { } session.endSession(); }
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
  } catch (_) { }
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
    try { logger?.warn?.('[PURCHASES] Failed to update conversation marketplace status', { purchaseId: String(purchase?._id), status, error: e?.message }); } catch (_) { }
  }
}

// Helper: emit consistent WS events and refresh conversations for both participants
async function emitMarketplaceStatusChanged(app, purchase, status) {
  try {
    const ws = app.get('webSocketServer');
    const participants = [purchase?.buyerId?.toString?.(), purchase?.sellerId?.toString?.()].filter(Boolean);
    if (ws) {
      const now = new Date();
      const wsData = {
        conversationId: purchase?.conversationId?.toString?.() || purchase?.conversationId,
        purchaseId: purchase?._id?.toString?.() || purchase?._id,
        buyerId: purchase?.buyerId?.toString?.() || purchase?.buyerId,
        sellerId: purchase?.sellerId?.toString?.() || purchase?.sellerId,
        status,
        shippedAt: purchase?.shippedAt || null,
        deliveredAt: purchase?.deliveredAt || null,
        autoReleaseAt: purchase?.autoReleaseAt || null,
        timestamp: now.toISOString(),
        updatedAt: now.toISOString(), // Para priorização no front-end
        source: 'realtime' // Identifica origem do evento
      };

      for (const uid of participants) {
        ws.sendToUser(uid, {
          type: 'marketplace:status_changed',
          data: wsData
        });
      }

      if (ws.conversationHandler) {
        for (const uid of participants) {
          await ws.conversationHandler.sendConversationsUpdate(uid);
        }
      }
    }
    participants.forEach(pid => cache.invalidateUserCache(pid));
  } catch (_) { }
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

// GET /api/purchases/list - listagem paginada de compras/vendas do usuário (Marketplace + Boosting)
router.get('/list', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const type = String(req.query.type || '').toLowerCase(); // 'sales' | 'purchases'
    const statusParam = String(req.query.status || '').trim(); // e.g. 'initiated,escrow_reserved,shipped'
    const page = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '10')) || 10));

    // ========== MARKETPLACE PURCHASES ==========
    const marketFilter = {};
    if (type === 'sales') {
      marketFilter.sellerId = userId;
    } else if (type === 'purchases') {
      marketFilter.buyerId = userId;
    } else {
      marketFilter.$or = [{ buyerId: userId }, { sellerId: userId }];
    }
    if (statusParam) {
      const statuses = statusParam.split(',').map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
      if (statuses.length) marketFilter.status = { $in: statuses };
    }

    const purchases = await Purchase.find(marketFilter)
      .sort({ createdAt: -1 })
      .lean();

    // ========== BOOSTING ORDERS ==========
    const boostingFilter = {};

    // Filtrar por status se especificado
    if (statusParam) {
      const statuses = statusParam.split(',').map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
      if (statuses.length > 0) {
        boostingFilter.status = { $in: statuses };
      }
    }

    if (type === 'sales') {
      boostingFilter.boosterId = userId;
    } else if (type === 'purchases') {
      boostingFilter.clientId = userId;
    } else {
      boostingFilter.$or = [
        { boosterId: userId },
        { clientId: userId }
      ];
    }

    const boostingOrders = await BoostingOrder.find(boostingFilter)
      .sort({ createdAt: -1 })
      .lean();

    // ========== FALLBACK: BUSCAR AGREEMENTS (para boostings não migrados) ==========
    const agreementFilter = {};

    // Filtrar por status se especificado (mapear para status de Agreement)
    if (statusParam) {
      const statuses = statusParam.split(',').map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
      if (statuses.length > 0) {
        // Mapear status UI para status de Agreement
        const mappedStatuses = statuses.map(s => {
          if (s === 'shipped') return 'active';
          if (s === 'initiated') return 'pending';
          return s; // completed, cancelled permanecem iguais
        });
        agreementFilter.status = { $in: mappedStatuses };
      }
    }

    if (type === 'sales') {
      agreementFilter['parties.booster.userid'] = userId;
    } else if (type === 'purchases') {
      agreementFilter['parties.client.userid'] = userId;
    } else {
      agreementFilter.$or = [
        { 'parties.booster.userid': userId },
        { 'parties.client.userid': userId }
      ];
    }

    // Buscar apenas agreements que NÃO foram migrados (não têm BoostingOrder correspondente)
    const existingBoostingOrderAgreementIds = (boostingOrders || []).map(bo => String(bo.agreementId)).filter(Boolean);
    if (existingBoostingOrderAgreementIds.length > 0) {
      agreementFilter._id = { $nin: existingBoostingOrderAgreementIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    const agreementsNotMigrated = await Agreement.find(agreementFilter)
      .sort({ createdAt: -1 })
      .lean();

    console.log('[PURCHASES LIST] BoostingOrders:', boostingOrders.length, 'Agreements não migrados:', agreementsNotMigrated.length);

    // ========== BUSCAR DADOS ADICIONAIS ==========
    const itemIds = Array.from(new Set((purchases || []).map(p => (p.itemId || '').toString()).filter(Boolean)));

    // Coletar IDs de usuários, filtrando apenas ObjectIds válidos
    const allBuyerIds = Array.from(new Set([
      ...(purchases || []).map(p => (p.buyerId || '').toString()).filter(id => mongoose.Types.ObjectId.isValid(id)),
      ...(boostingOrders || []).map(bo => (bo.clientId || '').toString()).filter(id => mongoose.Types.ObjectId.isValid(id)),
      ...(agreementsNotMigrated || []).map(ag => (ag.parties?.client?.userid || '').toString()).filter(id => mongoose.Types.ObjectId.isValid(id))
    ]));
    const allSellerIds = Array.from(new Set([
      ...(purchases || []).map(p => (p.sellerId || '').toString()).filter(id => mongoose.Types.ObjectId.isValid(id)),
      ...(boostingOrders || []).map(bo => (bo.boosterId || '').toString()).filter(id => mongoose.Types.ObjectId.isValid(id)),
      ...(agreementsNotMigrated || []).map(ag => (ag.parties?.booster?.userid || '').toString()).filter(id => mongoose.Types.ObjectId.isValid(id))
    ]));

    // Buscar reviews para verificar quais pedidos já foram avaliados
    const purchaseIds = (purchases || []).map(p => p._id);
    const boostingOrderIds = (boostingOrders || []).map(bo => bo.agreementId);
    const agreementIds = (agreementsNotMigrated || []).map(ag => ag._id);
    const allAgreementIds = [...boostingOrderIds, ...agreementIds];

    const [items, buyers, sellers, purchaseReviews, boostingReviews] = await Promise.all([
      itemIds.length > 0 ? MarketItem.find({ _id: { $in: itemIds } }).select('_id title image images deliveryMethod').lean() : Promise.resolve([]),
      allBuyerIds.length > 0 ? User.find({ _id: { $in: allBuyerIds } }).select('_id name legalName username avatar').lean() : Promise.resolve([]),
      allSellerIds.length > 0 ? User.find({ _id: { $in: allSellerIds } }).select('_id name legalName username avatar').lean() : Promise.resolve([]),
      purchaseIds.length > 0 ? Review.find({ purchaseId: { $in: purchaseIds } }).select('purchaseId').lean() : Promise.resolve([]),
      allAgreementIds.length > 0 ? Review.find({ agreementId: { $in: allAgreementIds } }).select('agreementId').lean() : Promise.resolve([])
    ]);

    const itemMap = new Map((items || []).map(d => [String(d._id), d]));
    const buyerMap = new Map((buyers || []).map(u => [String(u._id), u]));
    const sellerMap = new Map((sellers || []).map(u => [String(u._id), u]));
    const userName = (u) => (u?.name || u?.legalName || u?.username || 'Usuário');

    // Criar Maps de reviews para verificação rápida
    const purchaseReviewSet = new Set((purchaseReviews || []).map(r => String(r.purchaseId)));
    const agreementReviewSet = new Set((boostingReviews || []).map(r => String(r.agreementId)));

    // ========== FORMAT MARKETPLACE ORDERS ==========
    const marketplaceOrders = (purchases || []).map(p => {
      const item = itemMap.get(String(p.itemId)) || {};
      const buyer = buyerMap.get(String(p.buyerId));
      const seller = sellerMap.get(String(p.sellerId));
      const img = item.image || (Array.isArray(item.images) && item.images.length ? String(item.images[0]) : '');
      return {
        _id: String(p._id),
        orderNumber: String(p._id).slice(-8).toUpperCase(),
        status: String(p.status || ''),
        price: Number(p.price) || 0,
        feePercent: p.feePercent,
        feeAmount: p.feeAmount,
        sellerReceives: p.sellerReceives,
        createdAt: p.createdAt,
        type: 'marketplace',
        hasReview: purchaseReviewSet.has(String(p._id)), // Verifica se já foi avaliado
        item: { _id: String(p.itemId || ''), title: String(item.title || ''), image: img },
        buyer: { _id: String(p.buyerId || ''), name: userName(buyer) },
        seller: { _id: String(p.sellerId || ''), name: userName(seller) },
        deliveryMethod: item?.deliveryMethod || ''
      };
    });

    // ========== FORMAT BOOSTING ORDERS ==========
    const formattedBoostingOrders = (boostingOrders || []).map(bo => {
      // BoostingOrder já tem todos os dados estruturados!
      const buyer = buyerMap.get(String(bo.clientId));
      const seller = sellerMap.get(String(bo.boosterId));

      const title = bo.serviceSnapshot?.game
        ? `Boosting ${bo.serviceSnapshot.game}`
        : 'Boosting';

      // Mapear status do BoostingOrder para status compatível com marketplace UI
      // Status possíveis: pending, active, completed, cancelled, expired, disputed
      const boostingStatus = String(bo.status || 'pending').toLowerCase();
      let mappedStatus = boostingStatus;

      if (boostingStatus === 'active') {
        mappedStatus = 'shipped'; // Em andamento
      } else if (boostingStatus === 'pending') {
        mappedStatus = 'initiated'; // Pendente
      } else if (boostingStatus === 'expired') {
        mappedStatus = 'cancelled'; // Expirados tratados como cancelados
      } else if (boostingStatus === 'disputed') {
        mappedStatus = 'shipped'; // Disputados aparecem como em progresso (aguardando resolução)
      }
      // completed e cancelled permanecem iguais (sem alteração)

      // Determinar timestamp correto baseado no status
      let orderTimestamp = bo.createdAt;
      if (boostingStatus === 'completed' && bo.completedAt) {
        orderTimestamp = bo.completedAt;
      } else if (boostingStatus === 'cancelled' && bo.cancelledAt) {
        orderTimestamp = bo.cancelledAt;
      } else if (boostingStatus === 'expired' && bo.expiredAt) {
        orderTimestamp = bo.expiredAt;
      } else if (boostingStatus === 'active' && bo.activatedAt) {
        orderTimestamp = bo.activatedAt;
      }

      return {
        _id: String(bo._id),
        orderNumber: bo.orderNumber || String(bo._id).slice(-8).toUpperCase(),
        agreementId: String(bo.agreementId || ''),
        status: mappedStatus,
        price: Number(bo.price) || 0,
        feePercent: 0,
        feeAmount: 0,
        sellerReceives: Number(bo.price) || 0,
        createdAt: orderTimestamp,
        type: 'boosting',
        hasReview: bo.hasReview || agreementReviewSet.has(String(bo.agreementId)),
        item: {
          _id: String(bo.boostingRequestId || ''),
          title,
          image: ''
        },
        buyer: {
          _id: String(bo.clientId || ''),
          name: bo.clientData?.name || userName(buyer)
        },
        seller: {
          _id: String(bo.boosterId || ''),
          name: bo.boosterData?.name || userName(seller)
        },
        boostingRequest: {
          _id: String(bo.boostingRequestId || ''),
          game: bo.serviceSnapshot?.game || '',
          currentRank: bo.serviceSnapshot?.currentRank,
          desiredRank: bo.serviceSnapshot?.desiredRank
        }
      };
    });

    // ========== FORMAT AGREEMENTS NÃO MIGRADOS ==========
    const formattedAgreements = (agreementsNotMigrated || []).map(ag => {
      const clientId = ag.parties?.client?.userid || '';
      const boosterId = ag.parties?.booster?.userid || '';
      const buyer = buyerMap.get(String(clientId));
      const seller = sellerMap.get(String(boosterId));

      const title = ag.proposalSnapshot?.game
        ? `Boosting ${ag.proposalSnapshot.game}`
        : ag.metadata?.boostingData?.game
          ? `Boosting ${ag.metadata.boostingData.game}`
          : 'Boosting';

      // Mapear status do Agreement para status compatível com marketplace UI
      const agreementStatus = String(ag.status || 'pending').toLowerCase();
      let mappedStatus = agreementStatus;

      if (agreementStatus === 'active') {
        mappedStatus = 'shipped'; // Em andamento
      } else if (agreementStatus === 'pending') {
        mappedStatus = 'initiated'; // Pendente
      }
      // completed e cancelled permanecem iguais

      // Determinar timestamp correto baseado no status
      let orderTimestamp = ag.createdAt;
      if (agreementStatus === 'completed' && ag.completedAt) {
        orderTimestamp = ag.completedAt;
      } else if (agreementStatus === 'cancelled' && ag.cancelledAt) {
        orderTimestamp = ag.cancelledAt;
      } else if (agreementStatus === 'active' && ag.activatedAt) {
        orderTimestamp = ag.activatedAt;
      }

      return {
        _id: String(ag._id),
        orderNumber: ag.agreementId || String(ag._id).slice(-8).toUpperCase(),
        agreementId: String(ag._id || ''),
        status: mappedStatus,
        price: Number(ag.proposalSnapshot?.price || ag.price || 0),
        feePercent: 0,
        feeAmount: 0,
        sellerReceives: Number(ag.proposalSnapshot?.price || ag.price || 0),
        createdAt: orderTimestamp,
        type: 'boosting',
        hasReview: agreementReviewSet.has(String(ag._id)),
        item: {
          _id: String(ag.boostingRequestId || ''),
          title,
          image: ''
        },
        buyer: {
          _id: String(clientId),
          name: ag.parties?.client?.name || userName(buyer)
        },
        seller: {
          _id: String(boosterId),
          name: ag.parties?.booster?.name || userName(seller)
        },
        boostingRequest: {
          _id: String(ag.boostingRequestId || ''),
          game: ag.proposalSnapshot?.game || ag.metadata?.boostingData?.game || '',
          currentRank: ag.proposalSnapshot?.currentRank || ag.metadata?.boostingData?.currentRank,
          desiredRank: ag.proposalSnapshot?.desiredRank || ag.metadata?.boostingData?.desiredRank
        }
      };
    });

    // ========== MERGE AND DEDUPLICATE ==========
    // Primeiro juntamos todos os pedidos
    let allOrdersWithDuplicates = [...marketplaceOrders, ...formattedBoostingOrders, ...formattedAgreements];

    // Criamos um Map para detectar duplicatas baseado em propriedades relevantes
    const orderMap = new Map();
    const uniqueOrders = [];

    allOrdersWithDuplicates.forEach(order => {
      // Criar uma chave única baseada em identificação relevante
      // Para boosting, usamos o agreementId ou boostingRequestId se disponível
      let key;
      if (order.type === 'boosting') {
        // Para boosting, tentamos usar o request ID ou o item ID
        key = `boosting:${order.boostingRequest?._id || order.item?._id || order._id}`;
      } else {
        // Para marketplace, usamos o ID do item e do comprador
        key = `marketplace:${order.item?._id || ''}:${order.buyer?._id || ''}`;
      }

      // Se já temos um pedido com esta chave, vamos decidir qual manter
      if (orderMap.has(key)) {
        const existingOrder = orderMap.get(key);

        // Se o pedido existente é mais recente, ignoramos o atual
        if (new Date(existingOrder.createdAt) >= new Date(order.createdAt)) {
          return;
        }
      }

      // Armazenar o pedido no map e na lista de únicos
      orderMap.set(key, order);
      uniqueOrders.push(order);
    });

    console.log(`[PURCHASES] Removidas ${allOrdersWithDuplicates.length - uniqueOrders.length} duplicatas`);

    // Ordenar por data de criação (mais recente primeiro)
    const allOrders = uniqueOrders.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = allOrders.length;
    const paginatedOrders = allOrders.slice((page - 1) * limit, page * limit);

    // Log final
    console.log('[PURCHASES LIST RESULT]', {
      marketplaceOrders: marketplaceOrders.length,
      formattedBoostingOrders: formattedBoostingOrders.length,
      formattedAgreements: formattedAgreements.length,
      totalMerged: allOrders.length,
      paginatedCount: paginatedOrders.length,
      typesInPaginated: paginatedOrders.map(o => o.type)
    });

    return res.json({
      success: true,
      data: {
        orders: paginatedOrders,
        pagination: { total, page, limit, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('[PURCHASES LIST ERROR]', error);
    return res.status(500).json({ success: false, message: 'Erro ao listar compras/vendas', error: error.message });
  }
});

// GET /api/purchases/:purchaseId/review - get existing review and eligibility for current user
router.get('/:purchaseId/review', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const userId = req.user._id.toString();
    const p = await Purchase.findById(purchaseId);
    if (!p) return res.status(404).json({ success: false, message: 'Compra não encontrada' });
    const isParticipant = [p.buyerId?.toString(), p.sellerId?.toString()].includes(userId);
    if (!isParticipant) return res.status(403).json({ success: false, message: 'Acesso negado' });

    const existing = await Review.findOne({ purchaseId: p._id })
      .populate('userId', 'name avatar profileImage')
      .lean();

    const role = (p.buyerId?.toString() === userId) ? 'buyer' : 'seller';
    const eligible = role === 'buyer' && String(p.status) === 'completed' && !existing;

    let formatted = null;
    if (existing) {
      const helpful = (existing.helpfulVotes || []).filter(v => v.vote === 'helpful').length;
      const notHelpful = (existing.helpfulVotes || []).filter(v => v.vote === 'not_helpful').length;
      formatted = { ...existing, isHelpful: helpful, isNotHelpful: notHelpful, orderStatus: 'completed' };
    }

    return res.json({ success: true, data: { review: formatted, eligible, role } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar avaliação da compra', error: error.message });
  }
});

// POST /api/purchases/initiate
router.post('/initiate', auth, async (req, res) => {
  try {
    const buyerId = req.user._id;
    const { itemId, price, sellerUserId, itemTitle, itemImage, buyerInfo, useCashback } = req.body || {};

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

    const buyer = await User.findById(buyerId);
    if (!buyer) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });

    // Influencer Coupon Handling
    let influencerId = null;
    let influencerCommission = 0;
    let buyerCashbackAmount = 0;
    let mediatorCommissionPercent = 10;
    let couponCodeApplied = null;
    let renewInfluencer = false;

    // First, check if a new coupon is provided
    let newPromoCode = null;
    if (req.body.couponCode) {
      const PromoCode = require('../models/PromoCode');
      newPromoCode = await PromoCode.findOne({
        code: String(req.body.couponCode).toUpperCase(),
        status: 'active',
        isInfluencerCoupon: true
      });
    }

    // Try to apply new coupon or use the active one
    let targetInfluencerCode = null;
    let targetInfluencerId = null;

    if (newPromoCode) {
      targetInfluencerCode = newPromoCode.code;
      targetInfluencerId = newPromoCode.influencerId;
      renewInfluencer = true;
    } else if (buyer.hasActiveInfluencer && buyer.hasActiveInfluencer()) {
      targetInfluencerCode = buyer.activeInfluencer.couponCode;
      targetInfluencerId = buyer.activeInfluencer.influencerId;
    }

    if (targetInfluencerCode && targetInfluencerId) {
      const PromoCode = require('../models/PromoCode');
      const activeCoupon = newPromoCode || await PromoCode.findOne({ code: targetInfluencerCode, status: 'active' });

      if (activeCoupon && activeCoupon.isInfluencerCoupon) {
        // VALIDATIONS
        // 1. Influencer cannot use their own coupon
        if (activeCoupon.influencerId && activeCoupon.influencerId.toString() === buyerId.toString()) {
          return res.status(400).json({ success: false, message: 'Você não pode usar seu próprio cupom de influenciador.' });
        }

        // Apply split from coupon
        const { commissionSplit } = activeCoupon;
        buyerCashbackAmount = round2((price * (commissionSplit.buyerDiscount || 0)) / 100);
        influencerCommission = round2((price * (commissionSplit.influencerCommission || 0)) / 100);
        mediatorCommissionPercent = commissionSplit.mediatorCommission || 10;
        influencerId = activeCoupon.influencerId;
        couponCodeApplied = activeCoupon.code;

        // Setup renewal
        if (renewInfluencer) {
          const expires = new Date();
          expires.setDate(expires.getDate() + 14); // 14 days validity
          buyer.activeInfluencer = {
            influencerId: activeCoupon.influencerId,
            couponCode: activeCoupon.code,
            expiresAt: expires
          };
        }
      }
    }

    // Fetch item to derive true seller and price (lean for initial validation)
    const itemDoc = await MarketItem.findById(itemId).lean();
    if (!itemDoc) return res.status(404).json({ success: false, message: 'Item não encontrado' });
    const isAutomaticDelivery = String(itemDoc.deliveryMethod || '').toLowerCase() === 'automatic'
      && !!(itemDoc.automaticDelivery && itemDoc.automaticDelivery.hasCredentials);
    // Validate seller id on the item (support legacy shapes). Prefer sellerId (main API canonical), then userId, then others
    let sellerUserIdFromItem = safeId(itemDoc.sellerId)
      || safeId(itemDoc.userId)
      || safeId(itemDoc.ownerId)
      || safeId(itemDoc.user)
      || safeId(itemDoc.createdBy);
    if (!sellerUserIdFromItem) {
      try { logger.warn('[PURCHASES] Invalid item seller id for initiate', { itemId, sellerId: itemDoc?.sellerId, userIdField: itemDoc?.userId, ownerId: itemDoc?.ownerId }); } catch (_) { }
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

    const finalPriceForBuyer = round2(Number(priceUsed));
    let cashbackUsed = 0;
    // Initial check for non-cashback balance (approximate, re-checked in tx)
    if (buyer.walletBalance < finalPriceForBuyer - (buyer.cashbackBalance || 0)) {
      return res.status(400).json({ success: false, message: 'Saldo insuficiente' });
    }

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
      const stored = new Date(buyer.birthDate).toISOString().slice(0, 10);
      const incoming = birthDate.toISOString().slice(0, 10);
      if (stored !== incoming) {
        return res.status(409).json({ success: false, message: 'Data de nascimento em conflito com a já vinculada à conta.' });
      }
    }
    if (buyer.email && buyer.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(409).json({ success: false, message: 'E-mail informado difere do e-mail da conta.' });
    }

    // FEE CALCULATION
    // totalFee = mediator (default 10) + influencer + buyerCashback
    const influencerPercent = influencerId ? round2((influencerCommission / priceUsed) * 100) : 0;
    const buyerCashbackPercent = round2((buyerCashbackAmount / priceUsed) * 100);
    const feePercent = mediatorCommissionPercent + influencerPercent + buyerCashbackPercent;

    // Total potential fee is the total split from original price
    const totalPotentialFee = round2((Number(priceUsed) * feePercent) / 100);
    // recorded fee in Purchase (only what belongs to mediator + influencer, NOT buyer cashback)
    // Actually, we record everything that is subtracted from seller as 'feeAmount'
    const platformFee = round2(totalPotentialFee - buyerCashbackAmount);
    const sellerReceives = round2(Number(priceUsed) - totalPotentialFee);

    const purchase = await runTx(async (session) => {
      // Stock and availability guard within the same transaction
      const itemInTx = await MarketItem.findById(itemId).session(session);
      if (!itemInTx) throw new Error('ITEM_NOT_FOUND');
      const isAccount = String(itemInTx.category || '').toLowerCase() === 'account' || itemInTx.stock == null;
      if (isAccount) {
        // Unique item: must be active to reserve
        if (String(itemInTx.status || 'active') !== 'active') {
          throw new Error('ITEM_UNAVAILABLE');
        }
        itemInTx.status = 'reserved';
        itemInTx.reservedAt = new Date();
        await itemInTx.save({ session });
      } else {
        // Multi-stock item: initialize stockLeft if missing, enforce bounds, decrement
        const maxCap = 9999;
        const declaredStock = Math.max(0, Math.min(Number(itemInTx.stock || 0), maxCap));
        if (!Number.isFinite(declaredStock) || declaredStock < 1) {
          throw new Error('INVALID_STOCK');
        }
        if (itemInTx.stockLeft == null || !Number.isFinite(Number(itemInTx.stockLeft))) {
          itemInTx.stockLeft = declaredStock;
        }
        if (Number(itemInTx.stockLeft) <= 0) {
          throw new Error('OUT_OF_STOCK');
        }
        itemInTx.stockLeft = Number(itemInTx.stockLeft) - 1;
        itemInTx.reservedCount = Number(itemInTx.reservedCount || 0) + 1;
        // If depleting to zero, move to reserved state to prevent further initiations until completion
        if (itemInTx.stockLeft === 0) {
          itemInTx.status = 'reserved';
        }
        itemInTx.reservedAt = new Date();
        await itemInTx.save({ session });
      }

      let p = await Purchase.create([{
        buyerId, sellerId: sellerUserIdFromItem, itemId, price: Number(priceUsed), feePercent, feeAmount: platformFee, sellerReceives,
        status: 'initiated',
        buyerInfo: { fullName, cpf, birthDate, email },
        influencerId,
        influencerCommission,
        cashbackAmount: buyerCashbackAmount,
        cashbackUsed,
        couponCode: couponCodeApplied,
        logs: [{ level: 'info', message: 'Purchase initiated' + (couponCodeApplied ? ` with coupon ${couponCodeApplied}` : '') + (cashbackUsed > 0 ? ` using ${cashbackUsed.toFixed(2)} cashback` : '') }]
      }], { session });
      p = p[0];

      // If coupon used, record usage in PromoCode
      if (couponCodeApplied) {
        const PromoCode = require('../models/PromoCode');
        await PromoCode.updateOne(
          { code: couponCodeApplied },
          {
            $inc: { currentUses: 1 },
            $push: { users: { userId: buyerId, redeemedAt: new Date(), cpfCnpj: cpf } }
          },
          { session }
        );
      }

      // RE-VALIDATE BALANCES INSIDE TRANSACTION
      const buyerInTx = await User.findById(buyerId).session(session);
      if (!buyerInTx) throw new Error('BUYER_NOT_FOUND');

      let currentCashbackUsed = 0;
      if (useCashback && buyerInTx.cashbackBalance > 0) {
        currentCashbackUsed = round2(Math.min(priceUsed, buyerInTx.cashbackBalance));
      }

      const finalAmountFromBalance = round2(priceUsed - currentCashbackUsed);

      // Anti-bypass: Check both balance fields
      if ((buyerInTx.walletBalance || 0) < finalAmountFromBalance || (buyerInTx.balance || 0) < finalAmountFromBalance) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      const before = round2(buyerInTx.walletBalance || 0);
      const after = round2(before - finalAmountFromBalance);
      buyerInTx.walletBalance = after;
      buyerInTx.balance = after;

      const cbBefore = round2(buyerInTx.cashbackBalance || 0);
      if (currentCashbackUsed > 0) {
        buyerInTx.cashbackBalance = round2(cbBefore - currentCashbackUsed);
      }

      if (!buyerInTx.cpfCnpj) buyerInTx.cpfCnpj = cpf;
      if (!buyerInTx.legalName) buyerInTx.legalName = fullName;
      if (!buyerInTx.birthDate) buyerInTx.birthDate = birthDate;
      await buyerInTx.save({ session });

      // Recalculate awarded cashback based ONLY on the real balance portion
      const actualAwardedCashback = round2((finalAmountFromBalance * buyerCashbackPercent) / 100);

      // Update the outside purchase object if needed, though we often use the returned 'p'
      p.cashbackAmount = actualAwardedCashback;
      p.cashbackUsed = currentCashbackUsed;
      // Adjust feeAmount (platform fee) to keep sellerReceives constant
      p.feeAmount = round2(priceUsed - sellerReceives - influencerCommission - actualAwardedCashback);
      await p.save({ session });

      await WalletLedger.create([{
        userId: buyerId,
        txId: null,
        direction: 'debit',
        reason: 'purchase_reserve',
        amount: finalAmountFromBalance,
        operationId: `purchase_reserve:${p._id.toString()}`,
        balanceBefore: before,
        balanceAfter: after,
        metadata: { source: 'purchase', purchaseId: p._id.toString(), itemId }
      }], { session });

      if (currentCashbackUsed > 0) {
        await WalletLedger.create([{
          userId: buyerId,
          txId: null,
          direction: 'debit',
          reason: 'cashback_usage',
          amount: currentCashbackUsed,
          operationId: `cashback_usage:${p._id.toString()}`,
          balanceBefore: cbBefore,
          balanceAfter: round2(cbBefore - currentCashbackUsed),
          metadata: { source: 'purchase', purchaseId: p._id.toString(), itemId }
        }], { session });
      }

      p.status = 'escrow_reserved';
      p.escrowReservedAt = new Date();
      await p.save({ session });

      if (isAutomaticDelivery) {
        p.status = 'shipped';
        p.shippedAt = new Date();
        const auto = new Date();
        auto.setDate(auto.getDate() + 7);
        p.autoReleaseAt = auto;
        p.logs.push({ level: 'info', message: 'Auto-shipped due to automatic delivery', data: { autoReleaseAt: auto } });
        await p.save({ session });
      }

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

    // Criar credenciais automáticas imediatamente após a compra, se aplicável
    try {
      const deliveryMethod = String(itemDoc.deliveryMethod || '').toLowerCase();
      if (deliveryMethod === 'automatic' && itemDoc?.automaticDelivery?.hasCredentials) {
        const accountDeliveryApiUrl = process.env.ACCOUNT_DELIVERY_API_URL || 'http://localhost:5000/api/v1/account-delivery';
        const rawDiscount = Number(itemDoc.discount ?? 0);
        const discountApplied = Number.isFinite(rawDiscount) ? rawDiscount : 0;

        const response = await axios.post(`${accountDeliveryApiUrl}/internal/create-from-purchase`, {
          buyerId: buyerId.toString(),
          sellerId: sellerUserIdFromItem.toString(),
          purchaseId: purchase._id.toString(),
          itemId,
          pricePaid: Number(priceUsed),
          discountApplied
        }, {
          headers: {
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY || ''}`,
            'Content-Type': 'application/json'
          }
        });

        console.log('[PURCHASES] Credenciais automáticas geradas na criação da compra:', {
          purchaseId: purchase._id.toString(),
          deliveryId: response?.data?.data?.deliveryId
        });
      }
    } catch (autoErr) {
      console.error('[PURCHASES] Falha ao gerar credenciais automáticas na criação:', autoErr?.message, autoErr?.response?.data);
    }

    // Proactively update conversations list for both participants and clear caches
    try {
      const ws = req.app.get('webSocketServer');
      const participants = [buyerId?.toString(), sellerUserIdFromItem?.toString()].filter(Boolean);
      if (ws?.conversationHandler) {
        for (const uid of participants) {
          await ws.conversationHandler.sendConversationsUpdate(uid);
        }
      }
      if (ws) {
        const conversationPayload = await ws.conversationHandler?.getSanitizedConversationForUser(conv._id, buyerId, {});
        if (conversationPayload) {
          const enrichedParticipants = participants.length ? participants : [buyerId?.toString(), sellerUserIdFromItem?.toString()].filter(Boolean);
          for (const uid of enrichedParticipants) {
            if (uid) {
              ws.sendToUser(uid, {
                type: 'conversation:new',
                data: { conversation: conversationPayload }
              });
            }
          }
        }
        const messageHandler = ws.messageHandler;
        if (messageHandler?.conversationHandler?.sendCompactUpdateToParticipants && messageHandler?.sendCompactUpdateToParticipants) {
          await messageHandler.conversationHandler.sendCompactUpdateToParticipants(conv, { content: 'Nova compra iniciada.' }, null);
        }
      }
      participants.forEach(pid => cache.invalidateUserCache(pid));
    } catch (_) { }

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
          title: 'Nova Venda!',
          message: `Um comprador iniciou a compra de ${itemTitle || 'seu item'}.`,
          data: { purchaseId: purchase._id, conversationId: conv._id, itemId }
        });
      }
    } catch (_) { }

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
    } catch (_) { }

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
      const before = round2(seller.walletBalance || seller.balance || 0);
      const after = round2(before + Number(purchase.sellerReceives));
      seller.walletBalance = after;
      seller.balance = after;
      await seller.save({ session });
      const releaseCreated = await WalletLedger.create([{
        userId: purchase.sellerId,
        txId: null,
        direction: 'credit',
        reason: 'purchase_release',
        amount: Number(purchase.sellerReceives),
        operationId: `purchase_release:${purchase._id.toString()}`,
        balanceBefore: before,
        balanceAfter: after,
        metadata: { source: 'purchase', purchaseId: purchase._id.toString(), itemId: purchase.itemId, price: Number(purchase.price), feeAmount: Number(purchase.feeAmount || 0), sellerReceives: Number(purchase.sellerReceives) }
      }], { session });

      // Log platform release into mediator (idempotent)
      try {
        const operationId = `release:${purchase._id.toString()}`;
        await Mediator.updateOne(
          { operationId },
          {
            $setOnInsert: {
              eventType: 'release',
              amount: Number(purchase.sellerReceives),
              currency: 'BRL',
              operationId,
              source: 'ZenithChatApi',
              occurredAt: new Date(),
              reference: {
                purchaseId: purchase._id,
                orderId: null,
                walletLedgerId: Array.isArray(releaseCreated) ? releaseCreated[0]?._id : (releaseCreated?._id || null),
                transactionId: null,
                asaasTransferId: null
              },
              metadata: { price: Number(purchase.price), feeAmount: Number(purchase.feeAmount || 0), sellerReceives: Number(purchase.sellerReceives) },
              description: 'Liberação de escrow ao vendedor'
            }
          },
          { upsert: true, session }
        );
      } catch (_) { }

      // Credit mediator and influencer with platform fee split
      try {
        const totalFeeAmount = Number(purchase.feeAmount || 0);
        const infCommission = Number(purchase.influencerCommission || 0);
        const mediatorFee = round2(totalFeeAmount - infCommission);

        if (totalFeeAmount > 0) {
          // 1. Credit Influencer if applicable
          if (infCommission > 0 && purchase.influencerId) {
            const influencer = await User.findById(purchase.influencerId).session(session);
            if (influencer) {
              const infBefore = round2(influencer.walletBalance || influencer.balance || 0);
              const infAfter = round2(infBefore + infCommission);
              influencer.walletBalance = infAfter;
              influencer.balance = infAfter;
              await influencer.save({ session });

              const infLedger = await WalletLedger.create([{
                userId: influencer._id,
                txId: null,
                direction: 'credit',
                reason: 'influencer_commission',
                amount: infCommission,
                operationId: `inf_comm:${purchase._id.toString()}`,
                balanceBefore: infBefore,
                balanceAfter: infAfter,
                metadata: { source: 'purchase', purchaseId: purchase._id.toString(), buyerId: purchase.buyerId, couponCode: purchase.couponCode }
              }], { session });

              // Log mediator event for influencer commission
              try {
                await Mediator.create([{
                  eventType: 'payout',
                  amount: infCommission,
                  currency: 'BRL',
                  operationId: `inf_comm:${purchase._id.toString()}`,
                  source: 'ZenithChatApi',
                  occurredAt: new Date(),
                  reference: {
                    purchaseId: purchase._id,
                    walletLedgerId: infLedger[0]?._id || null
                  },
                  metadata: { type: 'influencer_commission', influencerId: influencer._id, couponCode: purchase.couponCode },
                  description: `Comissão de influenciador para ${influencer.username || influencer.name}`
                }], { session });
              } catch (_) { }
            }
          }

          // 2. Credit Mediator with the remainder
          if (mediatorFee > 0) {
            let mediatorUser = null;
            const envId = process.env.MEDIATOR_USER_ID;
            const envEmail = process.env.MEDIATOR_EMAIL;
            if (envId) {
              try { mediatorUser = await User.findById(envId).session(session); } catch (_) { }
            }
            if (!mediatorUser && envEmail) {
              try { mediatorUser = await User.findOne({ email: envEmail }).session(session); } catch (_) { }
            }
            if (mediatorUser) {
              const medBefore = round2(mediatorUser.walletBalance || mediatorUser.balance || 0);
              const medAfter = round2(medBefore + mediatorFee);
              mediatorUser.walletBalance = medAfter;
              mediatorUser.balance = medAfter;
              await mediatorUser.save({ session });
              const created = await WalletLedger.create([{
                userId: mediatorUser._id,
                txId: null,
                direction: 'credit',
                reason: 'purchase_fee',
                amount: mediatorFee,
                operationId: `purchase_fee:${purchase._id.toString()}`,
                balanceBefore: medBefore,
                balanceAfter: medAfter,
                metadata: { source: 'purchase', purchaseId: purchase._id.toString(), itemId: purchase.itemId, sellerId: purchase.sellerId, price: Number(purchase.price), feeAmount: mediatorFee }
              }], { session });

              try {
                const medLedgerDoc = Array.isArray(created) ? created[0] : created;
                await Mediator.create([{
                  eventType: 'fee',
                  amount: mediatorFee,
                  currency: 'BRL',
                  operationId: `purchase_fee:${purchase._id.toString()}`,
                  source: 'ZenithChatApi',
                  occurredAt: new Date(),
                  reference: {
                    purchaseId: purchase._id,
                    walletLedgerId: medLedgerDoc?._id || null
                  },
                  metadata: { price: Number(purchase.price), feeAmount: mediatorFee, sellerReceives: Number(purchase.sellerReceives), sellerId: purchase.sellerId },
                  description: 'Taxa de mediação creditada ao mediador (líquida)'
                }], { session });
              } catch (_) { }
            }
          }
        }
      } catch (e) {
        try { logger?.error?.('[PURCHASES] Failed to credit mediator/influencer fees', { error: e?.message }); } catch (_) { }
      }

      // 3. Award Cashback to Buyer if applicable
      try {
        if (purchase.cashbackAmount > 0) {
          const buyer = await User.findById(purchase.buyerId).session(session);
          if (buyer) {
            const cbBefore = round2(buyer.cashbackBalance || 0);
            const cbAfter = round2(cbBefore + purchase.cashbackAmount);
            buyer.cashbackBalance = cbAfter;
            await buyer.save({ session });

            await WalletLedger.create([{
              userId: purchase.buyerId,
              txId: null,
              direction: 'credit',
              reason: 'cashback_reward',
              amount: purchase.cashbackAmount,
              operationId: `cashback_reward:${purchase._id.toString()}`,
              balanceBefore: cbBefore,
              balanceAfter: cbAfter,
              metadata: { source: 'purchase', purchaseId: purchase._id.toString(), itemId: purchase.itemId }
            }], { session });
          }
        }
      } catch (e) {
        try { logger?.error?.('[PURCHASES] Failed to award buyer cashback', { error: e?.message }); } catch (_) { }
      }

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
      } catch (_) { }

      purchase.status = 'completed';
      purchase.deliveredAt = new Date();
      purchase.logs.push({ level: 'info', message: 'Buyer confirmed delivery. Funds released to seller.' });
      await purchase.save({ session });

      await updateConversationMarketplaceStatus(session, purchase, 'completed');

      // Finalize item status: for unique items -> sold; for stock items -> sold if depleted else remain active
      try {
        const item = await MarketItem.findById(purchase.itemId).session(session);
        if (item) {
          const isAccount = String(item.category || '').toLowerCase() === 'account' || item.stock == null;
          if (isAccount) {
            item.status = 'sold';
            item.soldAt = new Date();
          } else {
            if (item.stockLeft == null) {
              // initialize defensively
              item.stockLeft = Math.max(0, Math.min(Number(item.stock || 0), 9999));
            }
            if (Number(item.stockLeft) <= 0) {
              item.status = 'sold';
              item.soldAt = new Date();
            } else {
              // keep available for next purchases
              item.status = 'active';
            }
          }
          await item.save({ session });
        }
      } catch (e) {
        try { logger?.warn?.('[PURCHASES] Failed to finalize MarketItem status on confirm', { purchaseId: String(purchase?._id), error: e?.message }); } catch (_) { }
      }
    });

    await emitMarketplaceStatusChanged(req.app, purchase, 'completed');

    try {
      const accountDeliveryApiUrl = process.env.ACCOUNT_DELIVERY_API_URL || 'http://localhost:5000/api/v1/account-delivery';
      await axios.post(`${accountDeliveryApiUrl}/internal/confirm-from-purchase`, {
        purchaseId: purchase._id.toString()
      }, {
        headers: {
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY || ''}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (autoDeliveryErr) {
      console.error('[PURCHASES] Falha ao marcar entrega automática como confirmada:', autoDeliveryErr?.message, autoDeliveryErr?.response?.data);
    }

    await sendBalanceUpdate(req.app, purchase.sellerId);
    // Also notify buyer so their UI can refresh transaction history
    await sendBalanceUpdate(req.app, purchase.buyerId);
    try {
      const ns = req.app?.locals?.notificationService;
      if (ns) {
        ns.sendNotification(String(purchase.sellerId), { type: 'purchase:completed', title: 'Pagamento liberado', message: 'O comprador confirmou o recebimento. Valor liberado na sua carteira.', data: { purchaseId } });
        ns.sendNotification(String(purchase.buyerId), { type: 'purchase:completed', title: 'Pedido concluído', message: 'Obrigado por confirmar. Pedido concluído com sucesso.', data: { purchaseId } });
      }
    } catch (_) { }

    return res.json({ success: true, message: 'Recebimento confirmado. Valores liberados ao vendedor.' });
  } catch (error) { return res.status(500).json({ success: false, message: 'Erro ao confirmar recebimento', error: error.message }); }
});

// POST /api/purchases/:purchaseId/not-received
router.post('/:purchaseId/not-received', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const buyerId = req.user._id;
    const comment = (req.body && req.body.comment) ? String(req.body.comment) : '';

    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Compra não encontrada' });
    if (purchase.buyerId.toString() !== buyerId.toString()) return res.status(403).json({ success: false, message: 'Acesso negado' });

    if (['completed', 'cancelled'].includes(String(purchase.status))) {
      return res.status(400).json({ success: false, message: 'Pedido já finalizado' });
    }

    await runTx(async (session) => {
      purchase.status = 'escrow_reserved';
      purchase.autoReleaseAt = null;
      purchase.logs.push({ level: 'warn', message: 'Buyer declared NOT RECEIVED. Reverted to escrow.', data: { buyerId: buyerId.toString(), comment: comment || undefined } });
      await purchase.save({ session });
      await updateConversationMarketplaceStatus(session, purchase, 'escrow_reserved');
    });

    await emitMarketplaceStatusChanged(req.app, purchase, 'escrow_reserved');

    // Cria um relatório para arbitragem
    try {
      const [buyer, seller] = await Promise.all([
        User.findById(buyerId),
        User.findById(purchase.sellerId)
      ]);

      // Prevent duplicate ticket for the same purchase
      const existing = await Report.findOne({ purchaseId: purchase._id });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Já existe um ticket para este pedido', data: { reportId: existing._id } });
      }

      const report = new Report({
        conversationId: purchase.conversationId,
        purchaseId: purchase._id,
        type: 'service_not_delivered',
        reason: 'buyer_not_received',
        description: comment || 'Comprador declarou que não recebeu o item.',
        reporter: {
          userid: buyerId,
          name: buyer?.name || buyer?.legalName || buyer?.username || 'Comprador',
          email: buyer?.email,
          avatar: buyer?.avatar || buyer?.profileImage,
          isVerified: !!buyer?.isVerified,
          registeredAt: buyer?.joinDate || buyer?.createdAt
        },
        reported: {
          userid: purchase.sellerId,
          name: seller?.name || seller?.legalName || seller?.username || 'Vendedor',
          email: seller?.email,
          avatar: seller?.avatar || seller?.profileImage,
          isVerified: !!seller?.isVerified,
          registeredAt: seller?.joinDate || seller?.createdAt
        },
        status: 'pending',
        priority: 'high'
      });
      try {
        await report.save();
      } catch (e) {
        if (e && (e.code === 11000 || e.code === 'E11000')) {
          return res.status(409).json({ success: false, message: 'Já existe um ticket para este pedido', data: { reportId: e?.keyValue?._id || null } });
        }
        throw e;
      }

      // Envia notificação ao Telegram com dados do cliente (comprador)
      try {
        const apiUrl = process.env.MAIN_API_URL || 'https://zenithggapi.vercel.app';
        let clientApi = null;
        try {
          const resp = await axios.get(`${apiUrl}/api/users/${buyerId}`, {
            headers: { 'Authorization': req.headers.authorization }
          });
          clientApi = resp?.data?.user || null;
        } catch (e) {
          try { logger?.warn?.('[PURCHASES] Falha ao obter dados do cliente na MAIN_API', { error: e?.message }); } catch (_) { }
        }

        await sendSupportTicketNotification({
          client: {
            id: String(buyerId),
            name: buyer?.name || buyer?.legalName || buyer?.username || clientApi?.name || null,
            username: clientApi?.username || null,
            email: buyer?.email || clientApi?.email || null,
            phone: clientApi?.whatsapp || clientApi?.phone || clientApi?.phoneNumber || clientApi?.mobile || null
          },
          reporter: {
            id: String(buyerId),
            name: buyer?.name || buyer?.legalName || buyer?.username || 'Comprador',
            username: clientApi?.username || null,
            email: buyer?.email || clientApi?.email || null,
            phone: buyer?.phone || buyer?.phoneNumber || buyer?.whatsapp || buyer?.mobile || buyer?.phoneNormalized || clientApi?.whatsapp || clientApi?.phone || clientApi?.phoneNumber || clientApi?.mobile || null
          },
          reported: {
            id: purchase?.sellerId?.toString?.() || String(purchase.sellerId),
            name: seller?.name || seller?.legalName || seller?.username || 'Vendedor',
            email: seller?.email || null
          },
          report: {
            id: report?._id?.toString?.() || String(report._id),
            type: 'service_not_delivered',
            reason: 'buyer_not_received',
            description: comment || 'Comprador declarou que não recebeu o item.'
          },
          context: {
            conversationId: purchase?.conversationId?.toString?.() || purchase.conversationId || null,
            purchaseId: purchase?._id?.toString?.() || String(purchaseId)
          }
        });
      } catch (_) { }

      // Notifica o vendedor
      try {
        const ns = req.app?.locals?.notificationService;
        if (ns) ns.sendNotification(String(purchase.sellerId), {
          type: 'purchase:not_received',
          title: 'Pedido não recebido',
          message: 'O comprador declarou que não recebeu o item. A liberação foi pausada e a mediação foi aberta.',
          data: { purchaseId }
        });
      } catch (_) { }

      return res.json({ success: true, message: 'Status retornado ao escrow. Vendedor notificado e arbitragem aberta.' });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Erro ao registrar não recebimento', error: error.message });
    }
  } catch (outerErr) {
    return res.status(500).json({ success: false, message: 'Erro ao registrar não recebimento', error: outerErr.message });
  }
});

// POST /api/purchases/:purchaseId/support-ticket
// GET /api/purchases/:purchaseId/support-ticket/status
router.get('/:purchaseId/support-ticket/status', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const purchase = await Purchase.findById(purchaseId);
    let conversationId = null;
    if (purchase) {
      conversationId = purchase.conversationId || null;
      if (!conversationId) {
        try {
          const conv = await Conversation.findOne({ 'metadata.purchaseId': purchase._id });
          if (conv) conversationId = conv._id;
        } catch (_) { }
      }
    }
    const existing = await Report.findOne({
      $or: [
        { purchaseId: purchase ? purchase._id : null },
        ...(conversationId ? [{ conversationId }] : [])
      ]
    });
    return res.json({ success: true, data: { exists: !!existing, reportId: existing ? existing._id : null } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao verificar status do ticket', error: error.message });
  }
});

router.post('/:purchaseId/support-ticket', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const userId = req.user._id;
    const { description = '', issueType = 'payment_issues', security: clientSecurity } = req.body || {};

    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Compra não encontrada' });

    const isBuyer = purchase.buyerId.toString() === userId.toString();
    const isSeller = purchase.sellerId.toString() === userId.toString();
    if (!isBuyer && !isSeller) return res.status(403).json({ success: false, message: 'Acesso negado' });

    // Content safety filter before creation
    try {
      const safety = checkProhibitedContent(String(description || ''));
      if (safety && safety.ok === false && Array.isArray(safety.violations) && safety.violations.length > 0) {
        return res.status(400).json({ success: false, message: 'Descrição contém conteúdo não permitido.', data: { violations: safety.violations } });
      }
    } catch (_) { }

    // Prevent duplicate ticket for the same purchase (also consider legacy tickets by conversation)
    let convIdForCheck = purchase.conversationId || null;
    if (!convIdForCheck) {
      try {
        const conv = await Conversation.findOne({ 'metadata.purchaseId': purchase._id });
        if (conv) convIdForCheck = conv._id;
      } catch (_) { }
    }
    const existing = await Report.findOne({
      $or: [
        { purchaseId: purchase._id },
        ...(convIdForCheck ? [{ conversationId: convIdForCheck }] : [])
      ]
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Já existe um ticket para este pedido', data: { reportId: existing._id } });
    }

    // Monta dados do denunciante e denunciado
    const [reporterUser, reportedUser] = await Promise.all([
      User.findById(userId),
      User.findById(isBuyer ? purchase.sellerId : purchase.buyerId)
    ]);

    // Conversa vinculada (se existir)
    let conversationId = purchase.conversationId || null;
    if (!conversationId) {
      try {
        const conv = await Conversation.findOne({ 'metadata.purchaseId': purchase._id });
        if (conv) conversationId = conv._id;
      } catch (_) { }
    }

    const report = new Report({
      conversationId,
      purchaseId: purchase._id,
      type: ['service_not_delivered', 'payment_issues', 'other'].includes(String(issueType)) ? String(issueType) : 'payment_issues',
      reason: 'support_ticket_opened',
      description: description || 'Ticket de suporte aberto pelo usuário.',
      reporter: {
        userid: reporterUser?._id || userId,
        name: reporterUser?.name || reporterUser?.legalName || reporterUser?.username || 'Usuário',
        email: reporterUser?.email,
        avatar: reporterUser?.avatar || reporterUser?.profileImage,
        isVerified: !!reporterUser?.isVerified,
        registeredAt: reporterUser?.joinDate || reporterUser?.createdAt
      },
      reported: {
        userid: reportedUser?._id,
        name: reportedUser?.name || reportedUser?.legalName || reportedUser?.username || 'Usuário',
        email: reportedUser?.email,
        avatar: reportedUser?.avatar || reportedUser?.profileImage,
        isVerified: !!reportedUser?.isVerified,
        registeredAt: reportedUser?.joinDate || reportedUser?.createdAt
      },
      status: 'pending',
      priority: 'high',
      security: {
        clientFingerprint: clientSecurity?.fingerprint || null,
        fingerprintComponents: clientSecurity?.components || null,
        ip: (req.headers['x-forwarded-for']?.toString?.() || '').split(',')[0] || req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        receivedAt: new Date()
      }
    });

    try {
      await report.save();
    } catch (e) {
      if (e && (e.code === 11000 || e.code === 'E11000')) {
        return res.status(409).json({ success: false, message: 'Já existe um ticket para este pedido' });
      }
      throw e;
    }

    // Envia notificação ao Telegram com dados do cliente (comprador)
    try {
      const apiUrl = process.env.MAIN_API_URL || 'https://zenithggapi.vercel.app';
      const clientUserId = purchase?.buyerId?.toString?.() || purchase.buyerId;
      let clientApi = null;
      try {
        if (clientUserId) {
          const resp = await axios.get(`${apiUrl}/api/users/${clientUserId}`, {
            headers: { 'Authorization': req.headers.authorization }
          });
          clientApi = resp?.data?.user || null;
        }
      } catch (e) {
        try { logger?.warn?.('[PURCHASES] Falha ao obter dados do cliente na MAIN_API (support-ticket)', { error: e?.message }); } catch (_) { }
      }

      await sendSupportTicketNotification({
        client: {
          id: String(clientUserId || ''),
          name: clientApi?.name || (reporterUser && reporterUser._id?.toString?.() === String(clientUserId) ? (reporterUser.name || reporterUser.legalName || reporterUser.username) : null),
          username: clientApi?.username || null,
          email: clientApi?.email || null,
          phone: clientApi?.whatsapp || clientApi?.phone || clientApi?.phoneNumber || clientApi?.mobile || null
        },
        reporter: {
          id: String(userId),
          name: reporterUser?.name || reporterUser?.legalName || reporterUser?.username || 'Usuário',
          email: reporterUser?.email || null,
          phone: reporterUser?.phone || reporterUser?.phoneNumber || reporterUser?.whatsapp || reporterUser?.mobile || reporterUser?.phoneNormalized || null
        },
        reported: {
          id: reportedUser?._id?.toString?.() || String(reportedUser?._id || ''),
          name: reportedUser?.name || reportedUser?.legalName || reportedUser?.username || 'Usuário',
          email: reportedUser?.email || null
        },
        report: {
          id: report?._id?.toString?.() || String(report._id),
          type: ['service_not_delivered', 'payment_issues', 'other'].includes(String(issueType)) ? String(issueType) : 'payment_issues',
          reason: 'support_ticket_opened',
          description: description || 'Ticket de suporte aberto pelo usuário.'
        },
        context: {
          conversationId: (conversationId && conversationId.toString) ? conversationId.toString() : conversationId,
          purchaseId: purchase?._id?.toString?.() || String(purchaseId)
        }
      });
    } catch (_) { }

    // Atualiza conversa com marcações leves, se existir
    try {
      if (conversationId) {
        await Conversation.findByIdAndUpdate(conversationId, {
          $set: {
            isReported: true,
            reportedAt: new Date(),
            reportedBy: userId
          }
        });
      }
    } catch (_) { }

    // Notifica via WS e Notifications
    try {
      const ws = req.app.get('webSocketServer');
      const participants = [purchase?.buyerId?.toString?.(), purchase?.sellerId?.toString?.()].filter(Boolean);
      if (ws) {
        for (const uid of participants) {
          ws.sendToUser(uid, {
            type: 'support:ticket_created',
            data: {
              conversationId: conversationId?.toString?.() || conversationId,
              purchaseId: purchase?._id?.toString?.() || purchase?._id,
              reportId: report?._id?.toString?.() || report?._id,
              issueType: report.type,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
      const ns = req.app?.locals?.notificationService;
      if (ns) {
        for (const uid of participants) {
          ns.sendNotification(String(uid), {
            type: 'support:ticket_created',
            title: 'Ticket de suporte aberto',
            message: 'Um ticket de suporte foi aberto para esta compra. Nossa equipe irá avaliar em breve.',
            data: { purchaseId: purchase._id, conversationId, reportId: report._id }
          });
        }
      }
    } catch (_) { }

    return res.json({ success: true, message: 'Ticket de suporte aberto com sucesso', data: { reportId: report._id } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao abrir ticket de suporte', error: error.message });
  }
});

// Helper core cancel logic to be reused by public and internal admin routes
async function performPurchaseCancel(app, purchaseId, reason) {
  const purchase = await Purchase.findById(purchaseId);
  if (!purchase) {
    const err = new Error('Compra não encontrada');
    err.statusCode = 404;
    throw err;
  }
  if (!['initiated', 'escrow_reserved'].includes(purchase.status)) {
    const err = new Error('Compra não pode ser cancelada neste status');
    err.statusCode = 400;
    throw err;
  }

  await runTx(async (session) => {
    const buyer = await User.findById(purchase.buyerId).session(session);
    if (!buyer) throw new Error('BUYER_NOT_FOUND');

    // Refund Main Wallet
    const walletRefundAmount = round2(Number(purchase.price || 0) - Number(purchase.cashbackUsed || 0));
    const before = round2(buyer.walletBalance || buyer.balance || 0);
    const after = round2(before + walletRefundAmount);
    buyer.walletBalance = after;
    buyer.balance = after;

    if (walletRefundAmount > 0) {
      await WalletLedger.create([{
        userId: purchase.buyerId,
        txId: null,
        direction: 'credit',
        reason: 'purchase_cancel_refund',
        amount: walletRefundAmount,
        operationId: `purchase_cancel_refund:${purchase._id.toString()}`,
        balanceBefore: before,
        balanceAfter: after,
        metadata: { source: 'purchase', purchaseId: purchase._id.toString(), itemId: purchase.itemId, adminReason: reason || null }
      }], { session });
    }

    // Refund Cashback Balance
    const cbUsed = Number(purchase.cashbackUsed || 0);
    if (cbUsed > 0) {
      const cbBefore = round2(buyer.cashbackBalance || 0);
      const cbAfter = round2(cbBefore + cbUsed);
      buyer.cashbackBalance = cbAfter;

      await WalletLedger.create([{
        userId: purchase.buyerId,
        txId: null,
        direction: 'credit',
        reason: 'cashback_refund',
        amount: cbUsed,
        operationId: `cashback_refund:${purchase._id.toString()}`,
        balanceBefore: cbBefore,
        balanceAfter: cbAfter,
        metadata: { source: 'purchase', purchaseId: purchase._id.toString(), itemId: purchase.itemId }
      }], { session });
    }

    await buyer.save({ session });

    purchase.status = 'cancelled';
    purchase.cancelledAt = new Date();
    purchase.logs.push({ level: 'warn', message: reason ? `Purchase cancelled and refunded (reason: ${reason})` : 'Purchase cancelled and refunded' });
    await purchase.save({ session });

    await updateConversationMarketplaceStatus(session, purchase, 'cancelled');

    // Restore item availability/stock when cancelling
    try {
      const item = await MarketItem.findById(purchase.itemId).session(session);
      if (item) {
        const isAccount = String(item.category || '').toLowerCase() === 'account' || item.stock == null;
        if (isAccount) {
          // Unique item: free it back to active if it was reserved
          if (String(item.status || '') === 'reserved') {
            item.status = 'active';
            item.reservedAt = null;
          }
        } else {
          // Multi-stock item: increment stockLeft and adjust status if needed
          const maxCap = 9999;
          const declaredStock = Math.max(0, Math.min(Number(item.stock || 0), maxCap));
          if (Number.isFinite(declaredStock) && declaredStock > 0) {
            if (item.stockLeft == null || !Number.isFinite(Number(item.stockLeft))) {
              item.stockLeft = 1;
            } else {
              item.stockLeft = Math.min(maxCap, Number(item.stockLeft) + 1);
            }
            // If we were reserved because stockLeft was 0, restore to active
            if (item.stockLeft > 0 && String(item.status || '') === 'reserved') {
              item.status = 'active';
            }
          }
          item.reservedAt = null;
        }

        await item.save({ session });
      }
    } catch (e) {
      try { logger?.warn?.('[PURCHASES] Failed to restore MarketItem on cancel', { purchaseId: String(purchase?._id), error: e?.message }); } catch (_) { }
    }
  });

  await emitMarketplaceStatusChanged(app, purchase, 'cancelled');
  await sendBalanceUpdate(app, purchase.buyerId);

  try {
    const ns = app?.locals?.notificationService;
    if (ns) {
      ns.sendNotification(String(purchase.buyerId), { type: 'purchase:cancelled', title: 'Compra cancelada', message: 'Seu pagamento foi estornado.', data: { purchaseId } });
      ns.sendNotification(String(purchase.sellerId), { type: 'purchase:cancelled', title: 'Compra cancelada', message: 'O pedido foi cancelado.', data: { purchaseId } });
    }
  } catch (_) { }

  return purchase;
}

// POST /api/purchases/:purchaseId/cancel (user-authenticated)
router.post('/:purchaseId/cancel', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const userId = req.user._id;
    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Compra não encontrada' });
    const isBuyer = purchase.buyerId.toString() === userId.toString();
    const isSeller = purchase.sellerId.toString() === userId.toString();
    if (!isBuyer && !isSeller) return res.status(403).json({ success: false, message: 'Acesso negado' });

    const updated = await performPurchaseCancel(req.app, purchaseId, null);
    return res.json({ success: true, message: 'Compra cancelada e valor estornado', data: { purchase: updated } });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: 'Erro ao cancelar compra', error: error.message });
  }
});

// Internal admin cancel: POST /api/purchases/internal/:purchaseId/cancel
router.post('/internal/:purchaseId/cancel', async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const { reason } = req.body || {};
    const updated = await performPurchaseCancel(req.app, purchaseId, reason);
    return res.json({ success: true, message: 'Compra cancelada e valor estornado', data: { purchase: updated } });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: 'Erro interno ao cancelar compra', error: error.message });
  }
});

// Internal auto-release job trigger (temporarily stubbed)
router.post('/auto-release/run', auth, async (_req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Auto-release job temporarily disabled.'
  });
});

router.get('/:purchaseId', auth, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const purchase = await Purchase.findById(purchaseId).lean();
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Compra não encontrada' });
    }

    // Only participants can view
    const userId = req.user?._id || req.user?.id;
    const isParticipant = [purchase.buyerId?.toString(), purchase.sellerId?.toString()].includes(userId?.toString());
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    // Populate item and users
    const [item, buyer, seller] = await Promise.all([
      MarketItem.findById(purchase.itemId).select('_id title image images deliveryMethod').lean(),
      User.findById(purchase.buyerId).select('_id name legalName username avatar rating').lean(),
      User.findById(purchase.sellerId).select('_id name legalName username avatar rating').lean()
    ]);

    const userName = (u) => (u?.name || u?.legalName || u?.username || 'Usuário');
    const itemImage = item?.image || (Array.isArray(item?.images) && item.images.length ? String(item.images[0]) : null);

    const data = {
      _id: purchase._id?.toString(),
      purchaseId: purchase._id?.toString(),
      orderNumber: String(purchase._id).slice(-8).toUpperCase(),
      buyerId: purchase.buyerId?.toString(),
      sellerId: purchase.sellerId?.toString(),
      itemId: purchase.itemId?.toString?.() || purchase.itemId,
      price: Number(purchase.price) || 0,
      status: purchase.status,
      feePercent: purchase.feePercent,
      feeAmount: purchase.feeAmount,
      sellerReceives: purchase.sellerReceives,
      conversationId: purchase.conversationId?.toString?.() || purchase.conversationId,
      createdAt: purchase.createdAt,
      escrowReservedAt: purchase.escrowReservedAt,
      shippedAt: purchase.shippedAt,
      deliveredAt: purchase.deliveredAt,
      autoReleaseAt: purchase.autoReleaseAt,
      item: {
        _id: String(purchase.itemId || ''),
        title: item?.title || 'Item',
        image: itemImage
      },
      buyer: {
        _id: String(purchase.buyerId || ''),
        name: userName(buyer),
        avatar: buyer?.avatar,
        rating: buyer?.rating
      },
      seller: {
        _id: String(purchase.sellerId || ''),
        name: userName(seller),
        avatar: seller?.avatar,
        rating: seller?.rating
      },
      deliveryMethod: item?.deliveryMethod || ''
    };

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar compra', error: error.message });
  }
});

// GET /api/purchases/list - listagem paginada de compras/vendas do usuário

module.exports = router;

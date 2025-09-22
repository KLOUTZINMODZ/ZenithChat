const express = require('express');
const mongoose = require('mongoose');
const MarketItem = require('../models/MarketItem');
const User = require('../models/User');
const logger = require('../utils/logger');

const router = express.Router();

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
  try {
    // Prefer panel shared secret (no browser token exposure)
    const panelSecret = req.headers['x-panel-secret'] || req.headers['X-Panel-Secret'];
    const expectedPanel = process.env.PANEL_PROXY_SECRET;
    if (expectedPanel && panelSecret && panelSecret === expectedPanel) {
      return next();
    }
    // Trust panel origin if configured (best-effort)
    const origin = req.header('Origin') || '';
    const referer = req.header('Referer') || '';
    const allowedOrigins = (process.env.PANEL_ALLOWED_ORIGINS || 'https://zenithpaineladm.vercel.app').split(',').map(s => s.trim()).filter(Boolean);
    const originTrusted = (!!origin && allowedOrigins.some(o => origin.startsWith(o))) || (!!referer && allowedOrigins.some(o => referer.startsWith(o)));
    if (originTrusted) {
      return next();
    }
    // Legacy admin key fallback
    const provided = req.headers['x-admin-key'] || req.headers['x-api-key'];
    const expected = process.env.ADMIN_API_KEY;
    if (expected && provided && provided === expected) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Acesso negado' });
  } catch (_) {
    return res.status(403).json({ success: false, message: 'Acesso negado' });
  }
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

// GET /api/admin/market-items/without-seller - list items missing seller
router.get('/market-items/without-seller', requireAdminKey, async (req, res) => {
  try {
    const items = await MarketItem.find({ $or: [ { userId: { $exists: false } }, { userId: null }, { sellerId: { $exists: false } }, { sellerId: null } ] }).select('_id title userId sellerId ownerId user createdBy');
    return res.json({ success: true, count: items.length, items });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar itens sem vendedor', error: error.message });
  }
});

module.exports = router;

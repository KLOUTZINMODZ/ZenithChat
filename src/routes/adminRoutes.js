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
    const items = await MarketItem.find({ $or: [ { userId: { $exists: false } }, { userId: null } ] }).select('_id title userId ownerId sellerId user createdBy');
    return res.json({ success: true, count: items.length, items });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar itens sem vendedor', error: error.message });
  }
});

module.exports = router;

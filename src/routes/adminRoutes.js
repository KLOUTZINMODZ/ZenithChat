const express = require('express');
const mongoose = require('mongoose');
const MarketItem = require('../models/MarketItem');
const User = require('../models/User');
const logger = require('../utils/logger');
const Report = require('../models/Report');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { decryptMessage } = require('../utils/encryption');

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
    const headerPanel = req.headers['x-panel-proxy-secret'];
    const headerAdmin = req.headers['x-admin-key'] || req.headers['x-api-key'];
    const panelSecret = process.env.PANEL_PROXY_SECRET || '';
    const adminKey = process.env.ADMIN_API_KEY || '';

    // Prefer PANEL_PROXY_SECRET. If it matches, allow.
    if (panelSecret && headerPanel && String(headerPanel) === String(panelSecret)) {
      return next();
    }
    // Backward compatibility: accept ADMIN_API_KEY if present and matches
    if (adminKey && headerAdmin && String(headerAdmin) === String(adminKey)) {
      return next();
    }

    return res.status(403).json({ success: false, message: 'Acesso negado' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Erro na verificação de chave de admin', error: e?.message });
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

// ========== SUPPORT / TICKETS (ADMIN) ==========

// GET /api/admin/support/tickets
// Query: page, limit, status, priority, type, q
router.get('/support/tickets', requireAdminKey, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20')) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    const { status, priority, type, q } = req.query || {};
    if (status) filter.status = String(status);
    if (priority) filter.priority = String(priority);
    if (type) filter.type = String(type);
    if (q) {
      const s = String(q).trim();
      if (s) {
        filter.$or = [
          { reason: new RegExp(s, 'i') },
          { description: new RegExp(s, 'i') },
          { 'reporter.name': new RegExp(s, 'i') },
          { 'reported.name': new RegExp(s, 'i') }
        ];
      }
    }

    const [tickets, total] = await Promise.all([
      Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Report.countDocuments(filter)
    ]);

    const mapped = tickets.map(t => ({
      _id: t._id,
      conversationId: t.conversationId,
      type: t.type,
      reason: t.reason,
      description: t.description,
      reporter: t.reporter,
      reported: t.reported,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));

    return res.json({
      success: true,
      data: {
        tickets: mapped,
        pagination: { total, page, limit, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    try { logger.error('[ADMIN][SUPPORT] Error listing tickets', error); } catch (_) {}
    return res.status(500).json({ success: false, message: 'Erro ao listar tickets', error: error.message });
  }
});

// GET /api/admin/support/tickets/:id
router.get('/support/tickets/:id', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const includeMessages = String(req.query.includeMessages || 'false').toLowerCase() === 'true';

    const report = await Report.findById(id);
    if (!report) return res.status(404).json({ success: false, message: 'Ticket não encontrado' });

    let messages = [];
    if (includeMessages && report.conversationId) {
      try {
        const raw = await Message.find({ conversation: report.conversationId, isDeleted: { $ne: true } })
          .populate('sender', 'name email avatar profileImage')
          .sort('-createdAt')
          .limit(50)
          .lean();
        messages = raw.map(msg => ({
          _id: msg._id,
          conversationId: msg.conversation,
          senderId: msg.sender?._id || null,
          sender: msg.sender ? { _id: msg.sender._id, name: msg.sender.name, profileImage: msg.sender.avatar || msg.sender.profileImage } : null,
          content: (() => { try { return decryptMessage(msg.content); } catch (_) { return msg.content; } })(),
          createdAt: msg.createdAt,
          type: msg.type || 'text'
        })).reverse();
      } catch (e) {
        try { logger.warn('[ADMIN][SUPPORT] Failed to fetch messages for ticket', { id, error: e?.message }); } catch (_) {}
      }
    }

    return res.json({ success: true, data: { report, messages } });
  } catch (error) {
    try { logger.error('[ADMIN][SUPPORT] Error fetching ticket detail', error); } catch (_) {}
    return res.status(500).json({ success: false, message: 'Erro ao obter ticket', error: error.message });
  }
});

// PATCH /api/admin/support/tickets/:id
// Body can include: { status?, priority?, resolution?, adminName?, note?, noteVisibility?, moderationAction? }
router.patch('/support/tickets/:id', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, resolution, adminName, note, noteVisibility, moderationAction } = req.body || {};

    const report = await Report.findById(id);
    if (!report) return res.status(404).json({ success: false, message: 'Ticket não encontrado' });

    const allowedStatus = ['pending','under_review','resolved','dismissed','escalated'];
    const allowedPriority = ['low','medium','high','critical'];
    if (status && allowedStatus.includes(String(status))) report.status = String(status);
    if (priority && allowedPriority.includes(String(priority))) report.priority = String(priority);

    if (resolution && typeof resolution === 'object') {
      report.resolution = {
        ...report.resolution,
        ...resolution,
        resolvedAt: resolution.resolvedAt ? new Date(resolution.resolvedAt) : (report.resolution?.resolvedAt || undefined)
      };
    }

    if (note && typeof note === 'string' && note.trim()) {
      const authorName = req.headers['x-admin-name'] || adminName || 'Admin';
      report.internalNotes.push({
        author: null,
        authorName: String(authorName),
        note: String(note),
        visibility: ['internal','parties'].includes(String(noteVisibility)) ? String(noteVisibility) : 'internal',
        createdAt: new Date()
      });
    }

    if (moderationAction && typeof moderationAction === 'object') {
      const ma = moderationAction || {};
      report.moderationActions.push({
        actionType: ma.actionType,
        moderatorId: null,
        moderatorName: ma.moderatorName || (adminName || 'Admin'),
        reason: ma.reason || '',
        actionDate: ma.actionDate ? new Date(ma.actionDate) : new Date(),
        notes: ma.notes || ''
      });
    }

    await report.save();
    return res.json({ success: true, data: { report } });
  } catch (error) {
    try { logger.error('[ADMIN][SUPPORT] Error updating ticket', error); } catch (_) {}
    return res.status(500).json({ success: false, message: 'Erro ao atualizar ticket', error: error.message });
  }
});

module.exports = router;

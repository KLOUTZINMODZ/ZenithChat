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
    const normalize = (v) => (v == null ? '' : String(v).trim());
    const headerPanel = normalize(req.headers['x-panel-proxy-secret']);
    const headerAdmin = normalize(req.headers['x-admin-key'] || req.headers['x-api-key']);
    const panelSecret = normalize(process.env.PANEL_PROXY_SECRET || '');
    const adminKey = normalize(process.env.ADMIN_API_KEY || '');

    // Allow trusted origin without additional headers
    const origin = normalize(req.headers.origin || req.headers.referer || '');
    const TRUSTED_ORIGINS = ['https://zenithpaineladm.vercel.app'];
    if (TRUSTED_ORIGINS.some((o) => origin.startsWith(o))) {
      return next();
    }

    // Prefer PANEL_PROXY_SECRET. If it matches, allow.
    if (panelSecret && headerPanel && headerPanel === panelSecret) {
      return next();
    }
    // Backward compatibility: accept ADMIN_API_KEY if present and matches
    if (adminKey && headerAdmin && headerAdmin === adminKey) {
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
// Query: page, limit, status, priority, type, q, any, id, conversationId, proposalId, purchaseId, reporterId, reportedId, reporterEmail, reportedEmail
router.get('/support/tickets', requireAdminKey, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20')) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    const { status, priority, type, q, any, id, conversationId, proposalId, purchaseId, reporterId, reportedId, reporterEmail, reportedEmail } = req.query || {};
    if (status) filter.status = String(status);
    if (priority) filter.priority = String(priority);
    if (type) filter.type = String(type);
    // Exact match filters for IDs
    const sid = safeId(id);
    if (sid) filter._id = sid;
    const scid = safeId(conversationId);
    if (scid) filter.conversationId = scid;
    const spid = safeId(proposalId);
    if (spid) filter.proposalId = spid;
    const spurch = safeId(purchaseId);
    if (spurch) filter.purchaseId = spurch;
    const sReporterId = safeId(reporterId);
    if (sReporterId) filter['reporter.userid'] = sReporterId;
    const sReportedId = safeId(reportedId);
    if (sReportedId) filter['reported.userid'] = sReportedId;
    // Emails (case-insensitive exact)
    function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    if (reporterEmail) filter['reporter.email'] = new RegExp(`^${escRe(reporterEmail)}$`, 'i');
    if (reportedEmail) filter['reported.email'] = new RegExp(`^${escRe(reportedEmail)}$`, 'i');

    // Build OR array from 'q' and 'any'
    let ors = [];
    if (q) {
      const s = String(q).trim();
      if (s) {
        ors.push(
          { reason: new RegExp(s, 'i') },
          { description: new RegExp(s, 'i') },
          { 'reporter.name': new RegExp(s, 'i') },
          { 'reported.name': new RegExp(s, 'i') }
        );
      }
    }
    if (any) {
      const s = String(any).trim();
      if (s) {
        // Extract potential ObjectIds and emails from the whole string
        const rawIds = (s.match(/[a-fA-F0-9]{24}/g) || []);
        const uniqIds = Array.from(new Set(rawIds));
        for (const tid of uniqIds) {
          const mid = safeId(tid);
          if (mid) {
            ors.push(
              { _id: mid },
              { conversationId: mid },
              { proposalId: mid },
              { purchaseId: mid },
              { 'reporter.userid': mid },
              { 'reported.userid': mid }
            );
          }
        }

        const rawEmails = (s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || []);
        const uniqEmails = Array.from(new Set(rawEmails));
        for (const em of uniqEmails) {
          const reEmail = new RegExp(`^${escRe(em)}$`, 'i');
          ors.push(
            { 'reporter.email': reEmail },
            { 'reported.email': reEmail }
          );
        }

        // If the entire input is a single ID token
        const maybeId = safeId(s);
        if (maybeId) {
          ors.push(
            { _id: maybeId },
            { conversationId: maybeId },
            { proposalId: maybeId },
            { purchaseId: maybeId },
            { 'reporter.userid': maybeId },
            { 'reported.userid': maybeId }
          );
        }

        // If the entire input looks like an email
        if (/@/.test(s)) {
          const reEmail = new RegExp(`^${escRe(s)}$`, 'i');
          ors.push(
            { 'reporter.email': reEmail },
            { 'reported.email': reEmail }
          );
        }

        // Fallback to text search as in 'q'
        ors.push(
          { reason: new RegExp(s, 'i') },
          { description: new RegExp(s, 'i') },
          { 'reporter.name': new RegExp(s, 'i') },
          { 'reported.name': new RegExp(s, 'i') }
        );
      }
    }
    if (ors.length) {
      // Merge with any prior $or (shouldn't exist yet) or set anew
      filter.$or = Array.isArray(filter.$or) ? filter.$or.concat(ors) : ors;
    }

    const [tickets, total] = await Promise.all([
      Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Report.countDocuments(filter)
    ]);

    const mapped = tickets.map(t => ({
      _id: t._id,
      conversationId: t.conversationId,
      proposalId: t.proposalId,
      purchaseId: t.purchaseId,
      qaQuestionId: t.qaQuestionId,
      qaItemId: t.qaItemId,
      qaMeta: t.qaMeta,
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

// GET /api/admin/users/lookup
// Query: q (string), limit (number)
// Searches by ObjectId, email, name, and username (if present in documents)
router.get('/users/lookup', requireAdminKey, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20')) || 20));
    if (!q) return res.status(400).json({ success: false, message: 'Parâmetro q é obrigatório' });

    const ors = [];
    // Exact ObjectId match
    const maybeId = safeId(q);
    if (maybeId) ors.push({ _id: maybeId });

    // Case-insensitive partials for name/email/username
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc(q), 'i');
    ors.push({ name: re });
    ors.push({ email: re });
    // Username is not in schema but may exist in documents; Mongoose allows querying unknown paths
    ors.push({ username: re });

    const users = await User.find({ $or: ors })
      .select('_id name email avatar username')
      .limit(limit)
      .lean();

    return res.json({ success: true, data: { users } });
  } catch (error) {
    try { logger.error('[ADMIN] users/lookup failed', error); } catch (_) {}
    return res.status(500).json({ success: false, message: 'Erro ao buscar usuários', error: error?.message });
  }
});

module.exports = router;

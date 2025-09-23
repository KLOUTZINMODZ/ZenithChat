const express = require('express');
const { auth } = require('../middleware/auth');
const Report = require('../models/Report');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const logger = require('../utils/logger');
const { decryptMessage } = require('../utils/encryption');
const SupportThread = require('../models/SupportThread');

const router = express.Router();

function requireAdminKey(req, res, next) {
  try {
    // Prefer panel secret (no need for browser token)
    const panelSecret = req.headers['x-panel-secret'] || req.headers['X-Panel-Secret'];
    const expectedPanel = process.env.PANEL_PROXY_SECRET;
    if (expectedPanel && panelSecret && panelSecret === expectedPanel) {
      return next();
    }
    // Trust panel origin if configured (best-effort)
    try {
      const origin = req.header('Origin') || '';
      const referer = req.header('Referer') || '';
      const allowedOrigins = (process.env.PANEL_ALLOWED_ORIGINS || 'https://zenithpaineladm.vercel.app').split(',').map(s => s.trim()).filter(Boolean);
      const originTrusted = (!!origin && allowedOrigins.some(o => origin.startsWith(o))) || (!!referer && allowedOrigins.some(o => referer.startsWith(o)));
      if (originTrusted) {
        return next();
      }
    } catch (_) {}
    // Fallback to legacy admin key
    const provided = req.headers['x-admin-key'] || req.headers['x-api-key'];
    const expected = process.env.ADMIN_API_KEY;
    if (expected && provided && provided === expected) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Acesso negado' });
  } catch (e) {
    return res.status(403).json({ success: false, message: 'Acesso negado' });
  }
}

// GET /api/support/tickets - Lista tickets do usuário (reporter ou reported)
router.get('/tickets', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const baseFilter = {
      $or: [
        { 'reporter.userid': userId },
        { 'reported.userid': userId }
      ]
    };

    if (status) {
      baseFilter.status = String(status);
    }

    const [tickets, total] = await Promise.all([
      Report.find(baseFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Report.countDocuments(baseFilter)
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

    res.json({
      success: true,
      data: {
        tickets: mapped,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    logger.error('[SUPPORT] Error listing tickets', error);
    res.status(500).json({ success: false, message: 'Erro ao listar tickets', error: error.message });
  }
});

// GET /api/support/tickets/:id - Detalhes do ticket e últimas mensagens da conversa
router.get('/tickets/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const report = await Report.findById(id);
    if (!report) return res.status(404).json({ success: false, message: 'Ticket não encontrado' });

    const isAllowed = report.reporter?.userid?.toString?.() === userId.toString() ||
                      report.reported?.userid?.toString?.() === userId.toString();
    if (!isAllowed) return res.status(403).json({ success: false, message: 'Acesso negado' });

    let messages = [];
    if (report.conversationId) {
      const conv = await Conversation.findById(report.conversationId);
      if (conv && conv.isParticipant(userId)) {
        const raw = await Message.find({ conversation: report.conversationId, isDeleted: { $ne: true } })
          .populate('sender', 'name email avatar profileImage')
          .sort('-createdAt')
          .limit(20)
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
      }
    }

    res.json({ success: true, data: { report, messages } });
  } catch (error) {
    logger.error('[SUPPORT] Error fetching ticket detail', error);
    res.status(500).json({ success: false, message: 'Erro ao obter ticket', error: error.message });
  }
});

module.exports = router;

// Admin endpoints (somente via ADMIN_API_KEY)
// GET /api/support/admin/threads
router.get('/admin/threads', requireAdminKey, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const filter = {};
    if (status) filter.status = String(status);
    if (type) filter.type = String(type);

    const [threads, total] = await Promise.all([
      SupportThread.find(filter)
        .populate('createdBy', 'name email avatar')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      SupportThread.countDocuments(filter)
    ]);

    const mapped = (threads || []).map(t => ({
      _id: t._id,
      type: t.type,
      status: t.status,
      linked: t.linked,
      participants: (t.participants || []).map(p => ({ userId: p.userId, role: p.role })),
      assignedTo: t.assignedTo || null,
      createdBy: t.createdBy, // populated minimal fields
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      lastMessageAt: t.lastMessageAt || t.updatedAt
    }));

    res.json({ success: true, data: { threads: mapped, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) } } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao listar threads de suporte', error: error.message });
  }
});

// Start or get user's support thread and dedicated conversation
// POST /api/support/user/start
router.post('/user/start', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const adminId = process.env.SUPPORT_ADMIN_USER_ID || process.env.ADMIN_IMPERSONATE_USER_ID;
    if (!adminId) {
      return res.status(500).json({ success: false, message: 'SUPPORT_ADMIN_USER_ID não configurado' });
    }

    // Find existing open thread
    let thread = await SupportThread.findOne({ createdBy: userId, type: 'ticket', status: { $ne: 'closed' } });

    // Helper to ensure Conversation exists & link into thread
    async function ensureConversation(t) {
      if (t?.linked?.conversationId) return t;
      const Conversation = require('../models/Conversation');
      const mongoose = require('mongoose');
      const adminObjId = new mongoose.Types.ObjectId(adminId);
      const userObjId = new mongoose.Types.ObjectId(userId);
      const participants = [userObjId, adminObjId];
      let conversation = await Conversation.findOne({ participants: { $all: participants, $size: 2 }, type: 'direct', 'metadata.kind': 'support' });
      if (!conversation) {
        const meta = new Map();
        meta.set('kind', 'support');
        meta.set('supportTitle', 'Zenith Suporte');
        meta.set('supportThreadId', t?._id?.toString?.());
        conversation = await Conversation.create({ participants, type: 'direct', name: 'Zenith Suporte', metadata: meta });
      }
      t.linked = t.linked || {};
      t.linked.conversationId = conversation._id;
      await t.save();
      return t;
    }

    if (!thread) {
      // Create new thread
      thread = await SupportThread.create({
        type: 'ticket',
        status: 'open',
        participants: [
          { userId, role: 'customer' },
          { userId: adminId, role: 'admin' }
        ],
        createdBy: userId,
        linked: { kind: 'conversation' }
      });
      thread = await ensureConversation(thread);
    } else {
      thread = await ensureConversation(thread);
    }

    return res.json({ success: true, data: { threadId: thread._id, conversationId: thread.linked?.conversationId } });
  } catch (error) {
    logger.error('[SUPPORT] Error starting user support thread', error);
    return res.status(500).json({ success: false, message: 'Erro ao iniciar suporte', error: error.message });
  }
});

// Close a support thread (admin)
// POST /api/support/admin/threads/:id/close
router.post('/admin/threads/:id/close', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const thread = await SupportThread.findById(id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread não encontrada' });
    thread.status = 'closed';
    await thread.save();
    try {
      if (thread.linked?.conversationId) {
        const Conversation = require('../models/Conversation');
        await Conversation.findByIdAndUpdate(thread.linked.conversationId, { isActive: false, isFinalized: true, finalizedAt: new Date() });
      }
    } catch (_) {}
    return res.json({ success: true, message: 'Suporte finalizado', data: { id: thread._id } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao finalizar suporte', error: error.message });
  }
});

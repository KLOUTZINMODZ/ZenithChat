const express = require('express');
const { auth } = require('../middleware/auth');
const Report = require('../models/Report');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const logger = require('../utils/logger');
const { decryptMessage } = require('../utils/encryption');

const router = express.Router();

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

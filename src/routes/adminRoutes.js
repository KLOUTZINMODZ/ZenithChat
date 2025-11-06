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

// GET /api/admin/users/lookup
// Query: q (string), limit (number)
// Searches by ObjectId, email, name, and username (if present in documents)
// IMPORTANT: This route MUST be before /users/:id to avoid route conflict
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

// GET /api/admin/users/:id - fetch single user including complaints counters
router.get('/users/:id', requireAdminKey, async (req, res) => {
  try {
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID inválido' });

    const user = await User.findById(id)
      .select('_id name email avatar username walletBalance lastSeen isOnline complaintsSent complaintsReceived createdAt phone phoneNormalized whatsapp mobile')
      .lean();
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });

    return res.json({ success: true, data: { user } });
  } catch (error) {
    try { logger.error('[ADMIN] users/:id failed', error); } catch (_) {}
    return res.status(500).json({ success: false, message: 'Erro ao buscar usuário', error: error?.message });
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

// ==================== ROTAS DE BANIMENTO ====================

/**
 * @route   POST /api/admin/users/:userId/ban
 * @desc    Banir usuário e desconectar imediatamente
 * @access  Admin
 */
router.post('/users/:userId/ban', requireAdminKey, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, duration } = req.body;
    const adminName = req.headers['x-admin-name'] || 'Admin';

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de usuário inválido'
      });
    }

    const banService = req.app.get('banService');
    
    if (!banService) {
      return res.status(500).json({
        success: false,
        message: 'BanService não disponível'
      });
    }

    const result = await banService.banUser(
      userId,
      reason || 'Violação dos termos de uso',
      null, // bannedBy (pode ser implementado com autenticação admin)
      duration ? parseInt(duration) : null
    );

    logger.info(`🚫 [ADMIN] Usuário banido por ${adminName}:`, {
      userId,
      reason,
      duration,
      ...result
    });

    return res.json(result);

  } catch (error) {
    logger.error('[ADMIN] Erro ao banir usuário:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao banir usuário',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/users/:userId/unban
 * @desc    Desbanir usuário
 * @access  Admin
 */
router.post('/users/:userId/unban', requireAdminKey, async (req, res) => {
  try {
    const { userId } = req.params;
    const adminName = req.headers['x-admin-name'] || 'Admin';

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de usuário inválido'
      });
    }

    const banService = req.app.get('banService');
    
    if (!banService) {
      return res.status(500).json({
        success: false,
        message: 'BanService não disponível'
      });
    }

    const result = await banService.unbanUser(userId);

    logger.info(`[ADMIN] Usuário desbanido por ${adminName}:`, {
      userId,
      ...result
    });

    return res.json(result);

  } catch (error) {
    logger.error('[ADMIN] Erro ao desbanir usuário:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao desbanir usuário',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/users/:userId/ban-status
 * @desc    Verificar status de banimento
 * @access  Admin
 */
router.get('/users/:userId/ban-status', requireAdminKey, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de usuário inválido'
      });
    }

    const banService = req.app.get('banService');
    const status = await banService.isUserBanned(userId);

    return res.json({
      success: true,
      ...status
    });

  } catch (error) {
    logger.error('[ADMIN] Erro ao verificar banimento:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar banimento',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/users/banned
 * @desc    Listar usuários banidos
 * @access  Admin
 */
router.get('/users/banned', requireAdminKey, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    const banService = req.app.get('banService');
    const result = await banService.listBannedUsers(limit, skip);

    return res.json(result);

  } catch (error) {
    logger.error('[ADMIN] Erro ao listar banidos:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao listar usuários banidos',
      error: error.message
    });
  }
});

// GET /api/admin/email-stats - Obter estatísticas REAIS e DETALHADAS de usuários para email
router.get('/email-stats', requireAdminKey, async (req, res) => {
  try {
    logger.info('=== INICIANDO ANÁLISE PROFUNDA DE USUÁRIOS ===');
    
    // Buscar TODOS os usuários
    const allUsersRaw = await User.find({}).lean();
    logger.info(`Total de usuários no banco: ${allUsersRaw.length}`);
    
    // IMPORTANTE: Buscar preferências de notificação do modelo correto
    // As preferências estão em NotificationPreferences (HackLoteAPI), não em User
    const NotificationPreferences = mongoose.connection.collection('notificationpreferences');
    const allPreferences = await NotificationPreferences.find({}).toArray();
    
    logger.info(`Total de preferências encontradas: ${allPreferences.length}`);
    
    // Criar mapa userId -> emailNotifications
    const emailPrefsMap = new Map();
    allPreferences.forEach(pref => {
      emailPrefsMap.set(pref.userId.toString(), pref.emailNotifications);
    });

    // Análise minuciosa de cada usuário
    const detailedAnalysis = {
      total: allUsersRaw.length,
      eligible: 0,
      notEligible: 0,
      breakdown: {
        trueExplicit: 0,
        falseExplicit: 0,
        undefinedValue: 0,
        nullValue: 0,
        noPreferencesObject: 0
      }
    };

    const eligibleUsers = [];
    const notEligibleUsers = [];

    // Analisar CADA usuário individualmente
    for (const user of allUsersRaw) {
      const userId = user._id.toString();
      const userInfo = {
        name: user.name,
        email: user.email,
        hasPreferencesObject: emailPrefsMap.has(userId),
        emailNotificationsValue: 'NOT_SET',
        emailNotificationsType: 'undefined',
        isEligible: false,
        reason: ''
      };

      // Buscar emailNotifications do modelo NotificationPreferences
      const emailNotif = emailPrefsMap.get(userId);
      
      if (emailNotif !== undefined) {
        userInfo.emailNotificationsValue = String(emailNotif);
        userInfo.emailNotificationsType = typeof emailNotif;
        userInfo.hasPreferencesObject = true;

        if (emailNotif === true) {
          detailedAnalysis.breakdown.trueExplicit++;
          detailedAnalysis.eligible++;
          userInfo.isEligible = true;
          userInfo.reason = 'emailNotifications === true (NotificationPreferences)';
          eligibleUsers.push(userInfo);
        } else if (emailNotif === false) {
          detailedAnalysis.breakdown.falseExplicit++;
          detailedAnalysis.notEligible++;
          userInfo.isEligible = false;
          userInfo.reason = 'emailNotifications === false (NotificationPreferences)';
          notEligibleUsers.push(userInfo);
        } else if (emailNotif === null) {
          detailedAnalysis.breakdown.nullValue++;
          detailedAnalysis.notEligible++;
          userInfo.isEligible = false;
          userInfo.reason = 'emailNotifications === null (NotificationPreferences)';
          notEligibleUsers.push(userInfo);
        }
      } else {
        // Sem preferências no banco (não criou documento NotificationPreferences ainda)
        detailedAnalysis.breakdown.undefinedValue++;
        detailedAnalysis.notEligible++;
        userInfo.hasPreferencesObject = false;
        userInfo.isEligible = false;
        userInfo.reason = 'Sem NotificationPreferences (default: false)';
        userInfo.emailNotificationsValue = 'undefined';
        userInfo.emailNotificationsType = 'undefined';
        notEligibleUsers.push(userInfo);
      }
    }

    logger.info('=== RESULTADO DA ANÁLISE ===');
    logger.info(`Total: ${detailedAnalysis.total}`);
    logger.info(`Elegíveis: ${detailedAnalysis.eligible}`);
    logger.info(`Não elegíveis: ${detailedAnalysis.notEligible}`);
    logger.info('Breakdown:', detailedAnalysis.breakdown);

    res.json({
      success: true,
      stats: {
        totalUsers: detailedAnalysis.total,
        eligibleUsers: detailedAnalysis.eligible
      },
      analysis: {
        ...detailedAnalysis,
        eligibleSample: eligibleUsers.slice(0, 10),
        notEligibleSample: notEligibleUsers.slice(0, 10),
        allEligible: eligibleUsers,
        allNotEligible: notEligibleUsers
      }
    });
  } catch (error) {
    logger.error('ERRO na análise de usuários:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar estatísticas',
      error: error.message,
      stack: error.stack
    });
  }
});

// POST /api/admin/revert-email-preferences - Reverter migração (remover emailNotifications undefined)
router.post('/revert-email-preferences', requireAdminKey, async (req, res) => {
  try {
    // Buscar todos os usuários com emailNotifications = true
    const users = await User.find({
      'preferences.emailNotifications': true
    }).select('name email preferences');

    logger.info(`Found ${users.length} users with emailNotifications=true`);

    let revertedCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        // Remover o campo emailNotifications (voltar para undefined)
        if (user.preferences) {
          user.preferences.emailNotifications = undefined;
          await user.save();
          revertedCount++;
        }
      } catch (error) {
        logger.error(`Error reverting user ${user.email}:`, error);
        errorCount++;
      }
    }

    logger.info(`Revert completed: ${revertedCount} reverted, ${errorCount} errors`);

    res.json({
      success: true,
      message: `Reversão concluída: ${revertedCount} usuários revertidos para undefined`,
      details: {
        total: users.length,
        reverted: revertedCount,
        errors: errorCount
      }
    });
  } catch (error) {
    logger.error('Error during revert:', error);
    res.status(500).json({
      success: false,
      message: 'Erro durante a reversão',
      error: error.message
    });
  }
});

// GET /api/admin/email-users-debug - Debug detalhado de todos os usuários e preferências
router.get('/email-users-debug', requireAdminKey, async (req, res) => {
  try {
    const allUsers = await User.find({})
      .select('name email')
      .lean();

    // Buscar preferências do modelo correto (NotificationPreferences)
    const NotificationPreferences = mongoose.connection.collection('notificationpreferences');
    const allPreferences = await NotificationPreferences.find({}).toArray();
    
    // Criar mapa userId -> emailNotifications
    const emailPrefsMap = new Map();
    allPreferences.forEach(pref => {
      emailPrefsMap.set(pref.userId.toString(), pref.emailNotifications);
    });

    const detailedList = allUsers.map(user => {
      const userId = user._id.toString();
      const emailNotif = emailPrefsMap.get(userId);
      
      return {
        name: user.name,
        email: user.email,
        hasPreferences: emailPrefsMap.has(userId),
        emailNotifications: emailNotif,
        emailNotificationsType: typeof emailNotif,
        isEligible: emailNotif === true
      };
    });

    const summary = {
      total: detailedList.length,
      eligible: detailedList.filter(u => u.isEligible).length,
      notEligible: detailedList.filter(u => !u.isEligible).length,
      breakdown: {
        explicitTrue: detailedList.filter(u => u.emailNotifications === true).length,
        explicitFalse: detailedList.filter(u => u.emailNotifications === false).length,
        undefined: detailedList.filter(u => u.emailNotifications === undefined).length,
        null: detailedList.filter(u => u.emailNotifications === null).length,
        noPreferences: detailedList.filter(u => !u.hasPreferences).length
      }
    };

    res.json({
      success: true,
      summary,
      users: detailedList
    });
  } catch (error) {
    logger.error('Error fetching email users debug:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar debug',
      error: error.message
    });
  }
});

// POST /api/admin/send-custom-email - Enviar email personalizado para usuários
router.post('/send-custom-email', requireAdminKey, async (req, res) => {
  try {
    const { templateType, subject, customMessage } = req.body;

    if (!templateType || !subject || !customMessage) {
      return res.status(400).json({
        success: false,
        message: 'Parâmetros obrigatórios: templateType, subject, customMessage'
      });
    }

    // Validar tipo de template
    const validTypes = ['warning', 'news', 'announcement'];
    if (!validTypes.includes(templateType)) {
      return res.status(400).json({
        success: false,
        message: 'Tipo de template inválido. Use: warning, news ou announcement'
      });
    }

    logger.info('=== INICIANDO CAMPANHA DE EMAIL ===');
    
    // Buscar TODOS os usuários
    const allUsersRaw = await User.find({}).lean();
    logger.info(`Total de usuários no banco: ${allUsersRaw.length}`);

    // Buscar preferências do modelo correto (NotificationPreferences)
    const NotificationPreferences = mongoose.connection.collection('notificationpreferences');
    const allPreferences = await NotificationPreferences.find({}).toArray();
    logger.info(`Total de preferências encontradas: ${allPreferences.length}`);
    
    // Criar mapa userId -> emailNotifications
    const emailPrefsMap = new Map();
    allPreferences.forEach(pref => {
      emailPrefsMap.set(pref.userId.toString(), pref.emailNotifications);
    });

    // Filtrar usando EXATAMENTE a mesma lógica do endpoint de stats
    const eligibleUsers = [];
    
    for (const user of allUsersRaw) {
      const userId = user._id.toString();
      const emailNotif = emailPrefsMap.get(userId);
      
      // Apenas usuários com emailNotifications === true explícito
      if (emailNotif === true) {
        eligibleUsers.push({
          name: user.name,
          email: user.email
        });
      }
    }

    const users = eligibleUsers;
    
    logger.info(`=== RESULTADO DO FILTRO ===`);
    logger.info(`Usuários elegíveis: ${users.length}/${allUsersRaw.length}`);
    users.forEach((user, index) => {
      logger.info(`${index + 1}. ${user.name} (${user.email})`);
    });

    if (users.length === 0) {
      return res.json({
        success: true,
        message: 'Nenhum usuário elegível encontrado para enviar emails',
        sentCount: 0,
        totalUsers: allUsersRaw.length
      });
    }

    const emailService = require('../services/emailService');
    
    // Responder imediatamente ao cliente
    res.json({
      success: true,
      message: `Iniciando envio de emails para ${users.length} usuários...`,
      totalUsers: users.length
    });

    // Processar emails em background de forma assíncrona
    setImmediate(async () => {
      let successCount = 0;
      let failCount = 0;

      // Gmail limits: ~100 emails per minute, ~500 per hour for free accounts
      // Use smaller batches with delays to respect rate limits
      const BATCH_SIZE = 10; // Reduced from 50 to 10
      const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches
      
      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        
        logger.info(`Starting batch ${batchNumber}/${Math.ceil(users.length / BATCH_SIZE)}`);
        
        // Enviar emails do batch em paralelo com retry
        const results = await Promise.allSettled(
          batch.map(async (user) => {
            // Retry logic with exponential backoff
            let retries = 3;
            let delay = 1000;
            
            for (let attempt = 1; attempt <= retries; attempt++) {
              try {
                await emailService.sendCustomEmail(
                  user.email,
                  user.name,
                  subject,
                  templateType,
                  customMessage
                );
                return { success: true };
              } catch (error) {
                if (attempt === retries || !error.responseCode || error.responseCode !== 421) {
                  throw error;
                }
                logger.warn(`Retry ${attempt}/${retries} for ${user.email} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
              }
            }
          })
        );

        // Contar sucessos e falhas
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            successCount++;
          } else {
            failCount++;
            logger.error(`Failed to send email to ${batch[index].email}:`, result.reason);
          }
        });

        logger.info(`Batch ${batchNumber} completed: ${successCount} total sent, ${failCount} total failed`);
        
        // Delay between batches to avoid rate limiting (except for last batch)
        if (i + BATCH_SIZE < users.length) {
          logger.info(`Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
      }

      logger.info(`Email campaign completed: ${successCount} success, ${failCount} failed out of ${users.length} total`);
    });

  } catch (error) {
    logger.error('Error sending custom emails:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao enviar emails'
    });
  }
});

// ===== Q&A Management Routes =====
const qaController = require('../controllers/qaController');

// Listar todas as perguntas (com filtros e paginação)
router.get('/qa', requireAdminKey, qaController.listAll);

// Deletar pergunta
router.delete('/qa/:id', requireAdminKey, qaController.deleteQuestion);

// Editar pergunta/resposta
router.put('/qa/:id', requireAdminKey, qaController.updateQuestion);

module.exports = router;

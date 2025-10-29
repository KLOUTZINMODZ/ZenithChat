const QAQuestion = require('../models/QAQuestion');
const MarketItem = require('../models/MarketItem');
const Report = require('../models/Report');
const User = require('../models/User');
const logger = require('../utils/logger');
const axios = require('axios');
const { sendSupportTicketNotification } = require('../services/TelegramService');
const { checkProhibitedContent } = require('../utils/contentFilter');

const sanitizeUserSnapshot = (user) => {
  if (!user) return null;
  return {
    _id: String(user._id || ''),
    name: user.name || 'Usuário',
    avatar: user.avatar || user.profilePicture || null,
  };
};

module.exports = {
  // GET /api/qa/items/:itemId/questions
  async listByItem(req, res) {
    try {
      const { itemId } = req.params;
      if (!itemId) {
        return res.status(400).json({ success: false, message: 'itemId é obrigatório' });
      }

      const questions = await QAQuestion.find({ itemId })
        .sort({ createdAt: -1 })
        .lean();

      return res.json({ success: true, data: { questions } });
    } catch (error) {
      logger.error('Failed to list Q&A by item:', error);
      return res.status(500).json({ success: false, message: 'Erro interno ao listar perguntas' });
    }
  },

  // POST /api/qa/items/:itemId/questions
  async createQuestion(req, res) {
    try {
      const { itemId } = req.params;
      const { question } = req.body || {};
      const userId = req.userId;

      if (!question || String(question).trim().length === 0) {
        return res.status(400).json({ success: false, message: 'A pergunta não pode estar vazia' });
      }
      const text = String(question).trim();
      if (text.length > 5000) {
        return res.status(400).json({ success: false, message: 'A pergunta excede o limite de 5000 caracteres' });
      }

      // Content Safety Filter: profanity, emails, phones, CPFs, and excessive digits
      try {
        const check = checkProhibitedContent(text);
        if (!check.ok) {
          return res.status(400).json({ success: false, message: 'Sua pergunta contém conteúdo não permitido (profanidade, contato ou dados sensíveis).', data: { violations: check.violations } });
        }
      } catch (e) {
        try { logger?.warn?.('[QA] contentFilter failed', { error: e?.message }); } catch (_) {}
      }

      const item = await MarketItem.findById(itemId).lean();
      if (!item) {
        return res.status(404).json({ success: false, message: 'Item não encontrado' });
      }

      const sellerId = String(item.sellerId || item.userId || '');
      if (!sellerId) {
        return res.status(400).json({ success: false, message: 'Item sem vendedor definido' });
      }

      if (String(userId) === sellerId) {
        return res.status(403).json({ success: false, message: 'O vendedor não pode enviar perguntas para o próprio item' });
      }

      const buyer = await User.findById(userId).lean();
      const seller = await User.findById(sellerId).lean();

      // Daily limit: max 5 questions per buyer per day (server local day)
      try {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(end.getDate() + 1);
        const todayCount = await QAQuestion.countDocuments({ buyerId: userId, createdAt: { $gte: start, $lt: end } });
        if (todayCount >= 5) {
          return res.status(429).json({ success: false, message: 'Limite diário de 5 perguntas atingido. Tente novamente amanhã.', data: { limit: 5, remaining: 0, resetAt: end.toISOString() } });
        }
      } catch (e) {
        try { logger?.warn?.('[QA] daily limit check failed', { error: e?.message }); } catch (_) {}
      }

      const qa = await QAQuestion.create({
        itemId,
        buyerId: userId,
        sellerId,
        question: text,
        status: 'pending',
        buyerSnapshot: sanitizeUserSnapshot(buyer),
        sellerSnapshot: sanitizeUserSnapshot(seller),
        createdAt: new Date(),
      });

      // Notificar vendedor em tempo real
      try {
        const notificationService = req.app.locals.notificationService;
        if (notificationService) {
          await notificationService.sendNotification(sellerId, {
            id: `qa_new_${qa._id}`,
            type: 'qa:new_question',
            title: 'Nova pergunta recebida',
            message: `Você recebeu uma nova pergunta de: ${buyer?.name || 'Comprador'}`,
            meta: {
              itemId: String(itemId),
              questionId: String(qa._id),
            }
          }, { persistent: true });
        }
      } catch (e) {
        logger.warn('Failed to send QA new question notification:', e.message);
      }

      return res.status(201).json({ success: true, data: { question: qa } });
    } catch (error) {
      logger.error('Failed to create QA question:', error);
      return res.status(500).json({ success: false, message: 'Erro interno ao criar pergunta' });
    }
  },

  // POST /api/qa/questions/:id/answer
  async answerQuestion(req, res) {
    try {
      const { id } = req.params;
      const { answer } = req.body || {};
      const userId = req.userId;

      if (!answer || String(answer).trim().length === 0) {
        return res.status(400).json({ success: false, message: 'A resposta não pode estar vazia' });
      }
      const ansText = String(answer).trim();
      if (ansText.length > 5000) {
        return res.status(400).json({ success: false, message: 'A resposta excede o limite de 5000 caracteres' });
      }

      const qa = await QAQuestion.findById(id);
      if (!qa) {
        return res.status(404).json({ success: false, message: 'Pergunta não encontrada' });
      }

      if (String(qa.sellerId) !== String(userId)) {
        return res.status(403).json({ success: false, message: 'Apenas o vendedor pode responder a pergunta' });
      }

      if (qa.status === 'answered') {
        return res.status(400).json({ success: false, message: 'Pergunta já foi respondida' });
      }

      qa.answer = ansText;
      qa.answeredAt = new Date();
      qa.status = 'answered';
      await qa.save();

      // Notificar comprador em tempo real
      try {
        const notificationService = req.app.locals.notificationService;
        const seller = await User.findById(userId).lean();
        if (notificationService) {
          await notificationService.sendNotification(String(qa.buyerId), {
            id: `qa_answered_${qa._id}`,
            type: 'qa:answered',
            title: 'Pergunta respondida',
            message: `Sua pergunta foi respondida por: ${seller?.name || 'Vendedor'}`,
            meta: {
              itemId: String(qa.itemId),
              questionId: String(qa._id),
            }
          }, { persistent: true });
        }
      } catch (e) {
        logger.warn('Failed to send QA answered notification:', e.message);
      }

      return res.json({ success: true, data: { question: qa } });
    } catch (error) {
      logger.error('Failed to answer QA question:', error);
      return res.status(500).json({ success: false, message: 'Erro interno ao responder pergunta' });
    }
  }
  ,

  // POST /api/qa/questions/:id/report
  async reportQuestion(req, res) {
    try {
      const { id } = req.params;
      const { reason, description } = req.body || {};
      const userId = req.userId;

      if (!reason || String(reason).trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Motivo é obrigatório' });
      }
      if (!description || String(description).trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Descrição é obrigatória' });
      }

      const qa = await QAQuestion.findById(id);
      if (!qa) {
        return res.status(404).json({ success: false, message: 'Pergunta não encontrada' });
      }

      // Block reporting own content
      if (String(qa.buyerId) === String(userId)) {
        return res.status(400).json({ success: false, message: 'Você não pode denunciar a própria pergunta' });
      }

      // Prevent duplicate report by same reporter against the same user (global across QA)
      const existing = await Report.findOne({ 'reporter.userid': userId, 'reported.userid': qa.buyerId, type: 'qa_comment' });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Você já denunciou este usuário por Q&A', data: { reportId: existing._id } });
      }

      // Load reporter and reported users
      const [reporter, reported, item] = await Promise.all([
        User.findById(userId).lean(),
        User.findById(qa.buyerId).lean(),
        MarketItem.findById(qa.itemId).lean()
      ]);

      let report;
      try {
      report = await Report.create({
        conversationId: null,
        proposalId: null,
        purchaseId: null,
        qaQuestionId: qa._id,
        qaItemId: qa.itemId,
        qaMeta: {
          status: qa.status,
          question: qa.question,
          answeredAt: qa.answeredAt || null,
          buyerSnapshot: qa.buyerSnapshot || null,
          sellerSnapshot: qa.sellerSnapshot || null,
          itemTitle: item?.title || null,
        },
        type: 'qa_comment',
        reason: String(reason).trim().slice(0, 200),
        description: String(description).trim().slice(0, 2000),
        reporter: {
          userid: reporter?._id || userId,
          name: reporter?.name || 'Usuário',
          email: reporter?.email || null,
          avatar: reporter?.avatar || reporter?.profilePicture || null,
          isVerified: !!reporter?.isVerified,
          registeredAt: reporter?.joinDate || reporter?.createdAt
        },
        reported: {
          userid: reported?._id || qa.buyerId,
          name: reported?.name || 'Usuário',
          email: reported?.email || null,
          avatar: reported?.avatar || reported?.profilePicture || null,
          isVerified: !!reported?.isVerified,
          registeredAt: reported?.joinDate || reported?.createdAt
        },
        status: 'pending',
        priority: 'medium'
      });
      } catch (e) {
        if (e && (e.code === 11000 || e.code === 'E11000')) {
          const dup = await Report.findOne({ 'reporter.userid': userId, 'reported.userid': qa.buyerId, type: 'qa_comment' }).lean();
          return res.status(409).json({ success: false, message: 'Você já denunciou este usuário por Q&A', data: { reportId: dup?._id || null } });
        }
        throw e;
      }

      // Optional: notify admins via WS
      try {
        const ns = req.app?.locals?.notificationService;
        if (ns) {
          // Notify reporter with a confirmation
          await ns.sendNotification(String(userId), {
            type: 'support:ticket_opened',
            title: 'Denúncia registrada',
            message: 'Sua denúncia foi registrada e será analisada pela equipe.',
            meta: { reportId: String(report._id), qaQuestionId: String(qa._id), itemId: String(qa.itemId) }
          }, { persistent: true });
        }
      } catch (e) {
        logger.warn('Failed to send ticket opened notification:', e.message);
      }

      // Notify via Telegram (best-effort)
      try {
        const apiUrl = process.env.MAIN_API_URL || 'https://zenithggapi.vercel.app';
        let clientApi = null;
        try {
          const resp = await axios.get(`${apiUrl}/api/users/${userId}`, {
            headers: { 'Authorization': req.headers.authorization }
          });
          clientApi = resp?.data?.user || null;
        } catch (e) {
          try { logger?.warn?.('[QA] Falha ao obter dados do cliente na MAIN_API', { error: e?.message }); } catch (_) {}
        }

        await sendSupportTicketNotification({
          client: {
            id: String(userId),
            name: reporter?.name || reporter?.legalName || reporter?.username || clientApi?.name || 'Usuário',
            username: clientApi?.username || null,
            email: reporter?.email || clientApi?.email || null,
            phone: clientApi?.whatsapp || clientApi?.phone || clientApi?.phoneNumber || clientApi?.mobile || null
          },
          reporter: {
            id: String(userId),
            name: reporter?.name || reporter?.legalName || reporter?.username || 'Usuário',
            username: clientApi?.username || null,
            email: reporter?.email || clientApi?.email || null,
            phone: reporter?.phone || reporter?.phoneNumber || reporter?.whatsapp || reporter?.mobile || reporter?.phoneNormalized || clientApi?.whatsapp || clientApi?.phone || clientApi?.phoneNumber || clientApi?.mobile || null
          },
          reported: {
            id: qa?.buyerId?.toString?.() || String(qa.buyerId),
            name: reported?.name || reported?.legalName || reported?.username || 'Autor da pergunta',
            email: reported?.email || null
          },
          report: {
            id: report?._id?.toString?.() || String(report._id),
            type: 'qa_comment',
            reason: String(reason).trim().slice(0, 200),
            description: String(description).trim().slice(0, 2000)
          },
          context: {
            qaQuestionId: String(qa._id),
            qaItemId: String(qa.itemId),
            itemTitle: report?.qaMeta?.itemTitle || null
          }
        });
      } catch (e) {
        try { logger?.warn?.('[QA] Falha ao enviar alerta Telegram', { error: e?.message }); } catch (_) {}
      }

      return res.status(201).json({ success: true, data: { reportId: report._id } });
    } catch (error) {
      logger.error('Failed to create QA report:', error);
      return res.status(500).json({ success: false, message: 'Erro interno ao criar denúncia' });
    }
  },

  // ===== ADMIN ROUTES =====

  // GET /api/admin/qa - Listar todas as perguntas (admin)
  async listAll(req, res) {
    try {
      const { page = 1, limit = 20, status, search } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const filter = {};
      if (status && ['pending', 'answered'].includes(status)) {
        filter.status = status;
      }
      if (search && String(search).trim()) {
        filter.$or = [
          { question: { $regex: String(search).trim(), $options: 'i' } },
          { answer: { $regex: String(search).trim(), $options: 'i' } }
        ];
      }

      const [questions, total] = await Promise.all([
        QAQuestion.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        QAQuestion.countDocuments(filter)
      ]);

      // Popular informações dos itens
      const itemIds = questions.map(q => q.itemId).filter(Boolean);
      const items = await MarketItem.find({ _id: { $in: itemIds } }).lean();
      const itemMap = new Map(items.map(item => [String(item._id), item]));

      const enrichedQuestions = questions.map(q => ({
        ...q,
        itemInfo: itemMap.get(String(q.itemId)) || null
      }));

      return res.json({
        success: true,
        data: {
          questions: enrichedQuestions,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit))
          }
        }
      });
    } catch (error) {
      logger.error('Failed to list all Q&A (admin):', error);
      return res.status(500).json({ success: false, message: 'Erro interno ao listar perguntas' });
    }
  },

  // DELETE /api/admin/qa/:id - Deletar pergunta (admin)
  async deleteQuestion(req, res) {
    try {
      const { id } = req.params;

      const qa = await QAQuestion.findById(id);
      if (!qa) {
        return res.status(404).json({ success: false, message: 'Pergunta não encontrada' });
      }

      await QAQuestion.findByIdAndDelete(id);

      // Log da ação admin
      logger.info(`[ADMIN] Q&A deleted: ${id} by admin ${req.userId}`);

      return res.json({ success: true, message: 'Pergunta deletada com sucesso' });
    } catch (error) {
      logger.error('Failed to delete Q&A (admin):', error);
      return res.status(500).json({ success: false, message: 'Erro interno ao deletar pergunta' });
    }
  },

  // PUT /api/admin/qa/:id - Editar pergunta/resposta (admin)
  async updateQuestion(req, res) {
    try {
      const { id } = req.params;
      const { question, answer, status } = req.body || {};

      const qa = await QAQuestion.findById(id);
      if (!qa) {
        return res.status(404).json({ success: false, message: 'Pergunta não encontrada' });
      }

      // Atualizar campos permitidos
      if (question !== undefined) {
        const text = String(question).trim();
        if (text.length > 5000) {
          return res.status(400).json({ success: false, message: 'A pergunta excede o limite de 5000 caracteres' });
        }
        qa.question = text;
      }

      if (answer !== undefined) {
        if (answer === null || answer === '') {
          qa.answer = null;
          qa.answeredAt = null;
          qa.status = 'pending';
        } else {
          const text = String(answer).trim();
          if (text.length > 5000) {
            return res.status(400).json({ success: false, message: 'A resposta excede o limite de 5000 caracteres' });
          }
          qa.answer = text;
          qa.answeredAt = qa.answeredAt || new Date();
          qa.status = 'answered';
        }
      }

      if (status && ['pending', 'answered'].includes(status)) {
        qa.status = status;
      }

      await qa.save();

      // Log da ação admin
      logger.info(`[ADMIN] Q&A updated: ${id} by admin ${req.userId}`);

      return res.json({ success: true, data: { question: qa }, message: 'Pergunta atualizada com sucesso' });
    } catch (error) {
      logger.error('Failed to update Q&A (admin):', error);
      return res.status(500).json({ success: false, message: 'Erro interno ao atualizar pergunta' });
    }
  }
};

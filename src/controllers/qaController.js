const QAQuestion = require('../models/QAQuestion');
const MarketItem = require('../models/MarketItem');
const User = require('../models/User');
const logger = require('../utils/logger');

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

      const qa = await QAQuestion.create({
        itemId,
        buyerId: userId,
        sellerId,
        question: String(question).trim(),
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

      qa.answer = String(answer).trim();
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
};

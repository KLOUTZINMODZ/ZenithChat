const Conversation = require('../models/Conversation');

/**
 * Middleware para verificar se o chat permite envio de mensagens
 * Bloqueia mensagens em chats finalizados
 */
const checkChatStatus = async (req, res, next) => {
  try {
    const { conversationId } = req.params || req.body;
    
    if (!conversationId) {
      return next();
    }

    const conversation = await Conversation.findById(conversationId);
    
    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Conversa não encontrada' 
      });
    }

    // Verificar se o chat está finalizado
    if (conversation.isFinalized) {
      return res.status(403).json({ 
        success: false, 
        message: 'Este chat foi finalizado e não aceita mais mensagens',
        chatStatus: 'finalized',
        finalizedAt: conversation.finalizedAt,
        reason: 'Serviço de boosting concluído'
      });
    }

    // Verificar se o chat está ativo
    if (!conversation.canReceiveMessages()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Este chat não está disponível para novas mensagens',
        chatStatus: 'inactive'
      });
    }

    // Adicionar informações da conversa ao request para uso posterior
    req.conversation = conversation;
    next();
  } catch (error) {
    console.error('Erro ao verificar status do chat:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erro interno do servidor' 
    });
  }
};

module.exports = checkChatStatus;

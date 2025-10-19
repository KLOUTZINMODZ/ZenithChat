const Conversation = require('../models/Conversation');

class ConversationController {

  async unblockConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const { reason } = req.body;

      console.log(`🔓 [API] Desbloqueando conversa ${conversationId}...`);
      console.log(`   Razão: ${reason || 'Nova proposta aceita'}`);

      const conversation = await Conversation.findById(conversationId);
      
      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: 'Conversa não encontrada'
        });
      }

      console.log(`   Estado anterior: isBlocked=${conversation.isBlocked}`);


      conversation.isBlocked = false;
      conversation.blockedReason = null;
      conversation.blockedAt = null;
      conversation.blockedBy = null;
      
      const savedConversation = await conversation.save();

      console.log(`[API] Conversa desbloqueada com sucesso:`);
      console.log(`   isBlocked: ${savedConversation.isBlocked}`);
      console.log(`   conversationId: ${savedConversation._id}`);

      res.json({
        success: true,
        message: 'Conversa desbloqueada com sucesso',
        conversation: {
          _id: savedConversation._id,
          isBlocked: savedConversation.isBlocked,
          blockedReason: savedConversation.blockedReason
        }
      });

    } catch (error) {
      console.error('❌ [API] Erro ao desbloquear conversa:', error);
      res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
      });
    }
  }
}

module.exports = new ConversationController();

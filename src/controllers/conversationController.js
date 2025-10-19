const Conversation = require('../models/Conversation');

class ConversationController {

  async unblockConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const { reason } = req.body;

      
      

      const conversation = await Conversation.findById(conversationId);
      
      if (!conversation) {
        return res.status(404).json({
          success: false,
        });
      }

      

      conversation.isBlocked = false;
      conversation.blockedReason = null;
      conversation.blockedAt = null;
      conversation.blockedBy = null;
      
      const savedConversation = await conversation.save();

      
      
      

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
      
      res.status(500).json({
        success: false,
      });
    }
  }
}

module.exports = new ConversationController();

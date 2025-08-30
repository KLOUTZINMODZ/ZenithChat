/**
 * Utilitário para enviar notificações WebSocket de mensagens system
 */

/**
 * Envia notificação WebSocket para mensagem system
 * @param {Object} io - Instância do Socket.IO
 * @param {Array} participants - Array de IDs dos participantes
 * @param {Object} message - Objeto da mensagem
 */
const notifySystemMessage = (io, participants, message) => {
  if (!io) {
    console.warn('⚠️ Socket.IO não disponível para notificação system');
    return;
  }

  try {
    participants.forEach(userId => {
      io.to(`user_${userId}`).emit('message:new', {
        _id: message._id,
        conversation: message.conversation,
        sender: message.sender,
        content: message.content,
        type: 'system',
        metadata: message.metadata,
        createdAt: message.createdAt
      });
    });
    
    console.log(`📨 Mensagem system enviada via WebSocket para ${participants.length} usuários`);
  } catch (error) {
    console.error('❌ Erro ao enviar notificação WebSocket system:', error);
  }
};

module.exports = {
  notifySystemMessage
};

const { v4: uuidv4 } = require('uuid');
const Message = require('../models/Message');
const logger = require('../utils/logger');

/**
 * Serviço centralizado para criação e entrega de mensagens do sistema
 * Garante que todas as mensagens do sistema sejam entregues via WebSocket
 */
class SystemMessageService {
  constructor(connectionManager = null) {
    this.connectionManager = connectionManager;
    this.pendingDeliveries = new Map(); // messageId -> {recipients, attempts, timeout}
    this.maxRetryAttempts = 3;
    this.retryDelays = [2000, 5000, 10000]; // 2s, 5s, 10s
  }

  setConnectionManager(connectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Criar e entregar mensagem do sistema
   */
  async createAndDeliverSystemMessage({
    conversationId,
    systemType,
    content,
    metadata = {},
    participants = [],
    expiresAt = null
  }) {
    try {
      const messageId = uuidv4();
      
      // Criar mensagem no banco
      const systemMessage = new Message({
        conversation: conversationId,
        sender: 'system',
        content,
        type: 'system',
        messageId,
        systemType,
        expiresAt,
        readBy: [],
        deliveredTo: [],
        metadata: {
          ...metadata,
          systemType,
          messageId,
          createdBy: 'system'
        }
      });

      await systemMessage.save();
      
      // Preparar mensagem para entrega
      const deliveryMessage = {
        messageId,
        conversationId,
        senderId: 'system',
        type: 'system',
        systemType,
        content,
        createdAt: systemMessage.createdAt.toISOString(),
        expiresAt,
        readBy: [],
        deliveredTo: [],
        metadata
      };

      // Entregar via WebSocket para todos os participantes
      if (participants.length > 0) {
        await this.deliverToParticipants(messageId, deliveryMessage, participants, conversationId);
      }

      logger.info(`System message created and delivered: ${messageId} (${systemType})`);
      return { messageId, systemMessage };

    } catch (error) {
      logger.error('Error creating system message:', error);
      throw error;
    }
  }

  /**
   * Entregar mensagem para participantes via WebSocket
   */
  async deliverToParticipants(messageId, message, participants, conversationId) {
    if (!this.connectionManager) {
      logger.warn('ConnectionManager not available, skipping WebSocket delivery');
      return;
    }

    const onlineParticipants = [];
    const offlineParticipants = [];

    // Separar participantes online/offline
    participants.forEach(participantId => {
      if (this.connectionManager.isUserOnline(participantId)) {
        onlineParticipants.push(participantId);
      } else {
        offlineParticipants.push(participantId);
      }
    });

    // Enviar para participantes online
    const deliveryResults = [];
    for (const participantId of onlineParticipants) {
      try {
        const delivered = this.connectionManager.sendToUser(participantId, {
          type: 'message:system_created',
          data: {
            message,
            conversationId,
            requiresAck: true
          },
          timestamp: new Date().toISOString()
        });

        if (delivered) {
          await this.markAsDelivered(messageId, participantId);
          deliveryResults.push({ participantId, status: 'delivered' });
        } else {
          deliveryResults.push({ participantId, status: 'failed' });
        }
      } catch (error) {
        logger.error(`Failed to deliver system message to ${participantId}:`, error);
        deliveryResults.push({ participantId, status: 'failed' });
      }
    }

    // Adicionar participantes offline e falhas à fila de retry
    const failedParticipants = deliveryResults
      .filter(r => r.status === 'failed')
      .map(r => r.participantId);
    
    const pendingParticipants = [...offlineParticipants, ...failedParticipants];
    
    if (pendingParticipants.length > 0) {
      this.scheduleRetry(messageId, message, pendingParticipants, conversationId);
    }

    logger.info(`System message ${messageId}: ${onlineParticipants.length - failedParticipants.length} delivered, ${pendingParticipants.length} pending`);
  }

  /**
   * Agendar retry para participantes que não receberam
   */
  scheduleRetry(messageId, message, participants, conversationId, attempt = 1) {
    if (attempt > this.maxRetryAttempts) {
      logger.warn(`System message ${messageId} exceeded max retry attempts`);
      this.pendingDeliveries.delete(messageId);
      return;
    }

    const delay = this.retryDelays[Math.min(attempt - 1, this.retryDelays.length - 1)];
    
    const timeout = setTimeout(async () => {
      await this.retryDelivery(messageId, message, participants, conversationId, attempt);
    }, delay);

    this.pendingDeliveries.set(messageId, {
      message,
      participants,
      conversationId,
      attempt,
      timeout
    });

    logger.info(`Scheduled retry ${attempt}/${this.maxRetryAttempts} for system message ${messageId} in ${delay}ms`);
  }

  /**
   * Tentar reenviar mensagem
   */
  async retryDelivery(messageId, message, participants, conversationId, attempt) {
    if (!this.connectionManager) return;

    const stillPending = [];

    for (const participantId of participants) {
      if (this.connectionManager.isUserOnline(participantId)) {
        try {
          const delivered = this.connectionManager.sendToUser(participantId, {
            type: 'message:system_created',
            data: {
              message,
              conversationId,
              requiresAck: true,
              isRetry: true,
              attempt
            },
            timestamp: new Date().toISOString()
          });

          if (delivered) {
            await this.markAsDelivered(messageId, participantId);
          } else {
            stillPending.push(participantId);
          }
        } catch (error) {
          logger.error(`Retry failed for participant ${participantId}:`, error);
          stillPending.push(participantId);
        }
      } else {
        stillPending.push(participantId);
      }
    }

    if (stillPending.length > 0) {
      this.scheduleRetry(messageId, message, stillPending, conversationId, attempt + 1);
    } else {
      this.pendingDeliveries.delete(messageId);
      logger.info(`System message ${messageId} delivered to all participants after ${attempt} attempts`);
    }
  }

  /**
   * Marcar mensagem como entregue
   */
  async markAsDelivered(messageId, userId) {
    try {
      await Message.findOneAndUpdate(
        { messageId },
        {
          $addToSet: { deliveredTo: { user: userId, deliveredAt: new Date() } }
        }
      );
    } catch (error) {
      logger.error(`Error marking system message as delivered: ${messageId}`, error);
    }
  }

  /**
   * Processar confirmação de entrega do cliente
   */
  async handleDeliveryConfirmation(messageId, userId) {
    try {
      await this.markAsDelivered(messageId, userId);
      
      // Remover da fila de pending se todos receberam
      const pending = this.pendingDeliveries.get(messageId);
      if (pending) {
        pending.participants = pending.participants.filter(id => id !== userId);
        
        if (pending.participants.length === 0) {
          clearTimeout(pending.timeout);
          this.pendingDeliveries.delete(messageId);
          logger.info(`System message ${messageId} fully delivered, removed from pending queue`);
        }
      }

      logger.debug(`Delivery confirmation received for system message ${messageId} from user ${userId}`);
    } catch (error) {
      logger.error('Error handling system message delivery confirmation:', error);
    }
  }

  /**
   * Criar mensagens específicas por tipo
   */
  async createTemporaryChatMessage(conversationId, proposalData, participants) {
    const content = `⏳ Chat Temporário criado...
💰 Proposta: R$ ${proposalData.price}
⏱️ Tempo estimado: ${proposalData.estimatedTime}
📝 Mensagem: ${proposalData.message || 'Nenhuma'}

💡 Este chat expira em 3 dias se a proposta não for aceita.`;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 3);

    return await this.createAndDeliverSystemMessage({
      conversationId,
      systemType: 'temporary_chat_created',
      content,
      metadata: {
        proposalId: proposalData.proposalId,
        price: proposalData.price,
        estimatedTime: proposalData.estimatedTime,
        message: proposalData.message
      },
      participants,
      expiresAt
    });
  }

  async createTemporaryExpiredMessage(conversationId, participants) {
    const content = '🚫 Este chat expirou porque a proposta não foi aceita em até 3 dias.';

    return await this.createAndDeliverSystemMessage({
      conversationId,
      systemType: 'chat_expired',
      content,
      metadata: {
        expiredAt: new Date().toISOString(),
        reason: 'timeout'
      },
      participants
    });
  }

  async createProposalAcceptedMessage(conversationId, proposalData, clientData, boosterData, participants) {
    const content = `✅ Proposta aceita! Cliente ${clientData.name} e Booster ${boosterData.name} foram conectados.
💰 Valor acordado: R$ ${proposalData.price}
⏱️ Tempo estimado: ${proposalData.estimatedTime}`;

    return await this.createAndDeliverSystemMessage({
      conversationId,
      systemType: 'proposal_accepted',
      content,
      metadata: {
        proposalId: proposalData.proposalId,
        price: proposalData.price,
        estimatedTime: proposalData.estimatedTime,
        clientName: clientData.name,
        boosterName: boosterData.name,
        acceptedAt: new Date().toISOString()
      },
      participants
    });
  }

  async createDeliveryConfirmedMessage(conversationId, participants) {
    const content = `✅ Entrega confirmada pelo cliente
🔒 Chat finalizado`;

    return await this.createAndDeliverSystemMessage({
      conversationId,
      systemType: 'delivery_confirmed',
      content,
      metadata: {
        confirmedAt: new Date().toISOString()
      },
      participants
    });
  }

  async createCancellationMessage(conversationId, reason, participants) {
    const content = `❌ Atendimento cancelado
📝 Motivo: ${reason || 'Não informado'}`;

    return await this.createAndDeliverSystemMessage({
      conversationId,
      systemType: 'cancellation',
      content,
      metadata: {
        reason,
        cancelledAt: new Date().toISOString()
      },
      participants
    });
  }

  /**
   * Limpar deliveries antigas (executar periodicamente)
   */
  cleanupOldDeliveries() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    for (const [messageId, pending] of this.pendingDeliveries.entries()) {
      if (pending.message.createdAt && new Date(pending.message.createdAt).getTime() < oneHourAgo) {
        clearTimeout(pending.timeout);
        this.pendingDeliveries.delete(messageId);
        logger.info(`Cleaned up old pending system message: ${messageId}`);
      }
    }
  }

  /**
   * Obter estatísticas do serviço
   */
  getStats() {
    return {
      pendingDeliveries: this.pendingDeliveries.size,
      hasConnectionManager: !!this.connectionManager
    };
  }
}

module.exports = SystemMessageService;

const logger = require('../utils/logger');
const cache = require('./GlobalCache');

/**
 * Route-Aware Conversation Cache Service
 * Garante que usuários recebam mensagens mesmo quando fora da rota de chat
 * Similar ao sistema de cache offline, mas específico para conversas
 */
class RouteAwareConversationCache {
  constructor() {
    this.userRouteStatus = new Map(); // userId -> { currentRoute, isInChatRoute, lastActivity }
    this.pendingConversationUpdates = new Map(); // userId -> [conversationUpdates]
    this.deliveryConfirmations = new Map(); // messageId -> { delivered: boolean, timestamp }
    
    // Configurações
    this.maxPendingUpdates = 100;
    this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 horas
    this.cleanupInterval = 5 * 60 * 1000; // 5 minutos
    
    this.startCleanupInterval();
    logger.info('🗂️ Route-Aware Conversation Cache initialized');
  }

  /**
   * Registra a rota atual do usuário
   */
  setUserRoute(userId, route) {
    const isInChatRoute = this.isChatRoute(route);
    
    this.userRouteStatus.set(userId, {
      currentRoute: route,
      isInChatRoute,
      lastActivity: Date.now()
    });
    
    logger.debug(`User ${userId} route updated: ${route} (inChat: ${isInChatRoute})`);
    
    // Se usuário entrou na rota de chat, entregar mensagens pendentes
    if (isInChatRoute) {
      this.deliverPendingConversationUpdates(userId);
    }
  }

  /**
   * Verifica se a rota é relacionada ao chat
   */
  isChatRoute(route) {
    const chatRoutes = [
      '/chat',
      '/messages',
      '/conversations',
      '/boosting-chat',
      '/temporary-chat'
    ];
    
    return chatRoutes.some(chatRoute => route.includes(chatRoute));
  }

  /**
   * Verifica se usuário está na rota de chat
   */
  isUserInChatRoute(userId) {
    const userStatus = this.userRouteStatus.get(userId);
    if (!userStatus) return false;
    
    // Considera usuário fora da rota se não teve atividade recente
    const isRecentlyActive = (Date.now() - userStatus.lastActivity) < 30000; // 30 segundos
    
    return userStatus.isInChatRoute && isRecentlyActive;
  }

  /**
   * Cache uma atualização de conversa para usuário fora da rota de chat
   */
  cacheConversationUpdate(userId, updateData) {
    try {
      // Se usuário está na rota de chat, não precisa cachear
      if (this.isUserInChatRoute(userId)) {
        logger.debug(`User ${userId} is in chat route, skipping cache`);
        return false;
      }

      const key = `conversation_updates:${userId}`;
      let updates = cache.get(key) || [];
      
      const updateWithMetadata = {
        ...updateData,
        timestamp: Date.now(),
        id: this.generateUpdateId(),
        cached: true,
        reason: 'user_outside_chat_route'
      };
      
      updates.push(updateWithMetadata);
      
      // Limitar número de updates pendentes
      if (updates.length > this.maxPendingUpdates) {
        updates = updates.slice(-this.maxPendingUpdates);
      }
      
      // Cache com TTL longo para garantir entrega
      cache.set(key, updates, this.cacheTimeout / 1000);
      
      logger.info(`📦 Cached conversation update for user ${userId} (outside chat route)`);
      logger.debug(`Update type: ${updateData.type}, conversation: ${updateData.conversationId}`);
      
      return true;
    } catch (error) {
      logger.error('Error caching conversation update:', error);
      return false;
    }
  }

  /**
   * Entrega todas as atualizações de conversa pendentes para um usuário
   */
  async deliverPendingConversationUpdates(userId) {
    try {
      const key = `conversation_updates:${userId}`;
      const pendingUpdates = cache.get(key) || [];
      
      if (pendingUpdates.length === 0) {
        return [];
      }
      
      logger.info(`📬 Delivering ${pendingUpdates.length} pending conversation updates to user ${userId}`);
      
      // Marcar como entregues
      const deliveredUpdates = pendingUpdates.map(update => ({
        ...update,
        delivered: true,
        deliveredAt: Date.now()
      }));
      
      // Limpar cache após entrega
      cache.delete(key);
      
      // Registrar confirmações de entrega
      deliveredUpdates.forEach(update => {
        if (update.id) {
          this.deliveryConfirmations.set(update.id, {
            delivered: true,
            timestamp: Date.now(),
            userId
          });
        }
      });
      
      logger.info(`✅ Delivered ${deliveredUpdates.length} conversation updates to user ${userId}`);
      
      return deliveredUpdates;
    } catch (error) {
      logger.error('Error delivering pending conversation updates:', error);
      return [];
    }
  }

  /**
   * Obtém atualizações pendentes sem removê-las do cache
   */
  getPendingConversationUpdates(userId) {
    try {
      const key = `conversation_updates:${userId}`;
      return cache.get(key) || [];
    } catch (error) {
      logger.error('Error getting pending conversation updates:', error);
      return [];
    }
  }

  /**
   * Cache uma nova mensagem para usuários fora da rota de chat
   */
  cacheNewMessage(conversationId, message, recipientIds) {
    const cachedCount = recipientIds.filter(userId => {
      if (this.isUserInChatRoute(userId)) {
        return false; // Usuário está no chat, não precisa cachear
      }
      
      return this.cacheConversationUpdate(userId, {
        type: 'new_message',
        conversationId,
        message,
        action: 'message_received'
      });
    }).length;
    
    if (cachedCount > 0) {
      logger.info(`📨 Cached new message for ${cachedCount} users outside chat route`);
    }
    
    return cachedCount;
  }

  /**
   * Cache atualização de status de conversa
   */
  cacheConversationStatusUpdate(conversationId, statusUpdate, participantIds) {
    const cachedCount = participantIds.filter(userId => {
      if (this.isUserInChatRoute(userId)) {
        return false;
      }
      
      return this.cacheConversationUpdate(userId, {
        type: 'conversation_status_update',
        conversationId,
        statusUpdate,
        action: 'conversation_updated'
      });
    }).length;
    
    if (cachedCount > 0) {
      logger.info(`🔄 Cached conversation status update for ${cachedCount} users outside chat route`);
    }
    
    return cachedCount;
  }

  /**
   * Cache notificação de proposta aceita/rejeitada
   */
  cacheProposalUpdate(conversationId, proposalUpdate, recipientIds) {
    const cachedCount = recipientIds.filter(userId => {
      if (this.isUserInChatRoute(userId)) {
        return false;
      }
      
      return this.cacheConversationUpdate(userId, {
        type: 'proposal_update',
        conversationId,
        proposalUpdate,
        action: 'proposal_status_changed'
      });
    }).length;
    
    if (cachedCount > 0) {
      logger.info(`💼 Cached proposal update for ${cachedCount} users outside chat route`);
    }
    
    return cachedCount;
  }

  /**
   * Confirma que uma atualização foi recebida pelo frontend
   */
  confirmDelivery(updateId, userId) {
    if (this.deliveryConfirmations.has(updateId)) {
      this.deliveryConfirmations.set(updateId, {
        ...this.deliveryConfirmations.get(updateId),
        confirmed: true,
        confirmedAt: Date.now()
      });
      
      logger.debug(`✅ Delivery confirmed for update ${updateId} by user ${userId}`);
      return true;
    }
    
    return false;
  }

  /**
   * Gera ID único para atualizações
   */
  generateUpdateId() {
    return `update_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Limpa dados antigos e confirmações de entrega
   */
  cleanup() {
    try {
      const now = Date.now();
      let cleanedCount = 0;
      
      // Limpar status de rota antigos (mais de 1 hora)
      for (const [userId, status] of this.userRouteStatus.entries()) {
        if (now - status.lastActivity > 60 * 60 * 1000) {
          this.userRouteStatus.delete(userId);
          cleanedCount++;
        }
      }
      
      // Limpar confirmações de entrega antigas (mais de 24 horas)
      for (const [updateId, confirmation] of this.deliveryConfirmations.entries()) {
        if (now - confirmation.timestamp > this.cacheTimeout) {
          this.deliveryConfirmations.delete(updateId);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        logger.debug(`🧹 Cleaned ${cleanedCount} old route-aware cache entries`);
      }
    } catch (error) {
      logger.error('Error during route-aware cache cleanup:', error);
    }
  }

  /**
   * Inicia intervalo de limpeza
   */
  startCleanupInterval() {
    setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * Obtém estatísticas do cache
   */
  getStats() {
    const totalPendingUpdates = Array.from(this.userRouteStatus.keys())
      .reduce((total, userId) => {
        const updates = this.getPendingConversationUpdates(userId);
        return total + updates.length;
      }, 0);
    
    return {
      activeUsers: this.userRouteStatus.size,
      usersInChatRoute: Array.from(this.userRouteStatus.values())
        .filter(status => status.isInChatRoute).length,
      totalPendingUpdates,
      deliveryConfirmations: this.deliveryConfirmations.size,
      maxPendingUpdates: this.maxPendingUpdates
    };
  }

  /**
   * Limpa todos os dados do cache
   */
  clear() {
    this.userRouteStatus.clear();
    this.pendingConversationUpdates.clear();
    this.deliveryConfirmations.clear();
    logger.info('🧹 Route-aware conversation cache cleared');
  }
}

module.exports = new RouteAwareConversationCache();

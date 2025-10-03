const logger = require('../utils/logger');
const cache = require('../services/GlobalCache');

class ConnectionManager {
  constructor() {
    this.connections = new Map();
    this.activeConversations = new Map();
    // Feature flag: gradual offline replay handled here (default off, rely on MessageHandler.sendPendingMessages)
    this.useGradualOfflineReplay = String(process.env.WS_CM_GRADUAL_OFFLINE || 'false').toLowerCase() === 'true';
  }

  addConnection(userId, ws) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    
    this.connections.get(userId).add(ws);

    const offlineStatus = cache.get(`offline_status:${userId}`);
    if (offlineStatus) {
      logger.info(`🔄 CACHE: User ${userId} reconnected - was offline since ${offlineStatus.activatedAt}`);
    }

    // Avoid duplicate offline replay: only send here if explicitly enabled.
    if (this.useGradualOfflineReplay) {
      const offlineMessages = cache.getOfflineMessages(userId);
      if (offlineMessages.length > 0) {
        logger.info(`📬 CACHE: User ${userId} reconnected - delivering ${offlineMessages.length} cached offline messages (gradual)`);
        this.sendCachedMessagesGradually(ws, userId, offlineMessages);
      }
    }
  }

  removeConnection(userId, ws) {
    if (this.connections.has(userId)) {
      this.connections.get(userId).delete(ws);
      if (this.connections.get(userId).size === 0) {
        this.connections.delete(userId);
        this.activeConversations.delete(userId);
      }
    }
  }

  getUserConnections(userId) {
    const userIdStr = userId?.toString();
    const connections = this.connections.get(userId) || this.connections.get(userIdStr) || [];
    
    return Array.from(connections);
  }

  isUserOnline(userId) {
    try {
      // Normalize by reusing getUserConnections which already checks both raw and string keys
      const conns = this.getUserConnections(userId);
      return Array.isArray(conns) ? conns.length > 0 : (conns?.size || 0) > 0;
    } catch (_) {
      return false;
    }
  }

  getOnlineUsers() {
    return Array.from(this.connections.keys());
  }

  setActiveConversation(userId, conversationId) {
    this.activeConversations.set(userId, conversationId);
  }

  getActiveConversation(userId) {
    return this.activeConversations.get(userId);
  }

  removeActiveConversation(userId) {
    this.activeConversations.delete(userId);
  }

  getConnectionCount() {
    let total = 0;
    this.connections.forEach(connections => {
      total += connections.size;
    });
    return total;
  }

  getUserConnectionCount(userId) {
    return this.connections.get(userId)?.size || 0;
  }

  broadcastToConversation(conversationId, message, excludeUserId = null) {
    const usersInConversation = [];
    
    this.activeConversations.forEach((convId, userId) => {
      if (convId === conversationId && userId !== excludeUserId) {
        usersInConversation.push(userId);
      }
    });

    usersInConversation.forEach(userId => {
      const connections = this.getUserConnections(userId);
      connections.forEach(ws => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(message));
        }
      });
    });

    return usersInConversation.length;
  }

  getAllConnections() {
    const allConnections = [];
    this.connections.forEach((connections, userId) => {
      connections.forEach(ws => {
        allConnections.push({ userId, ws });
      });
    });
    return allConnections;
  }

  sendCachedMessagesGradually(ws, userId, messages) {
    const sortedMessages = messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    let i = 0;
    const interval = setInterval(() => {
      if (i >= sortedMessages.length || ws.readyState !== 1) {
        clearInterval(interval);
        if (i >= sortedMessages.length) {
          logger.info(`Finished sending offline messages to user ${userId}.`);
          cache.clearOfflineMessages(userId);
        }
        return;
      }

      ws.send(JSON.stringify(sortedMessages[i]));
      i++;
    }, 300);
  }
}

module.exports = ConnectionManager;

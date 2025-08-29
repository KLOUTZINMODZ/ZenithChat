const logger = require('../utils/logger');
const cache = require('../services/GlobalCache');

class ConnectionManager {
  constructor() {
    this.connections = new Map();
    this.activeConversations = new Map();
  }

  addConnection(userId, ws) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId).add(ws);
    logger.info(`Connection added for user ${userId}. Total connections: ${this.connections.get(userId).size}`);

    const offlineMessages = cache.getOfflineMessages(userId);
    if (offlineMessages.length > 0) {
      logger.info(`User ${userId} reconnected. Sending ${offlineMessages.length} offline messages.`);
      this.sendCachedMessagesGradually(ws, userId, offlineMessages);
    }
  }

  removeConnection(userId, ws) {
    if (this.connections.has(userId)) {
      this.connections.get(userId).delete(ws);
      if (this.connections.get(userId).size === 0) {
        this.connections.delete(userId);
        this.activeConversations.delete(userId);
      }
      logger.info(`Connection removed for user ${userId}. Remaining connections: ${this.connections.get(userId)?.size || 0}`);
    }
  }

  getUserConnections(userId) {
    return Array.from(this.connections.get(userId) || []);
  }

  isUserOnline(userId) {
    return this.connections.has(userId) && this.connections.get(userId).size > 0;
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

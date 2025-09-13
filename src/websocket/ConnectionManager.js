const logger = require('../utils/logger');
const cache = require('../services/GlobalCache');

const WS_VERBOSE = (process.env.WS_VERBOSE_LOGS === '1' || process.env.WS_VERBOSE_LOGS === 'true' || process.env.CHAT_DEBUG === '1');
function vinfo(label, data = {}) {
  try {
    if (WS_VERBOSE) {
      logger.info(`[WS-VERBOSE] ${label} ${JSON.stringify(data)}`);
    }
  } catch (_) {}
}

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

    vinfo('CM:ADD_CONNECTION', { userId: String(userId), totalConnections: this.getUserConnectionCount(userId) });

    const offlineStatus = cache.get(`offline_status:${userId}`);
    if (offlineStatus) {
      logger.info(`🔄 CACHE: User ${userId} reconnected - was offline since ${offlineStatus.activatedAt}`);
      vinfo('CM:OFFLINE_STATUS', { userId: String(userId), since: offlineStatus.activatedAt });
    }

    const offlineMessages = cache.getOfflineMessages(userId);
    if (offlineMessages.length > 0) {
      logger.info(`📬 CACHE: User ${userId} reconnected - delivering ${offlineMessages.length} cached offline messages`);
      vinfo('CM:OFFLINE_COUNT', { userId: String(userId), count: offlineMessages.length });
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
      vinfo('CM:REMOVE_CONNECTION', { userId: String(userId), remaining: this.getUserConnectionCount(userId) });
    }
  }

  getUserConnections(userId) {
    const userIdStr = userId?.toString();
    const connections = this.connections.get(userId) || this.connections.get(userIdStr) || [];
    
    return Array.from(connections);
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
    vinfo('CM:SEND_CACHED_BEGIN', { userId: String(userId), total: sortedMessages.length });
    const interval = setInterval(() => {
      if (i >= sortedMessages.length || ws.readyState !== 1) {
        clearInterval(interval);
        if (i >= sortedMessages.length) {
          logger.info(`Finished sending offline messages to user ${userId}.`);
          vinfo('CM:SEND_CACHED_END', { userId: String(userId), sent: i });
          cache.clearOfflineMessages(userId);
        }
        return;
      }

      const msg = sortedMessages[i];
      const meta = {
        type: msg?.type,
        conversationId: msg?.data?.conversationId || msg?.data?.message?.conversation,
        messageId: msg?.data?.messageId || msg?.messageId,
        cached_reason: msg?.cached_reason
      };
      vinfo('CM:SEND_CACHED_ITEM', { userId: String(userId), idx: i, ...meta });
      try {
        ws.send(JSON.stringify(msg));
      } catch (err) {
        vinfo('CM:SEND_CACHED_ERROR', { userId: String(userId), idx: i, error: err?.message, ...meta });
      }
      i++;
    }, 300);
  }
}

module.exports = ConnectionManager;

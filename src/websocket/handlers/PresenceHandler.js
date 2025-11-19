const cache = require('../../services/GlobalCache');
const logger = require('../../utils/logger');
const Conversation = require('../../models/Conversation');

/**
 * PresenceHandler
 * - Tracks online/offline and lastSeen using ConnectionManager and GlobalCache
 * - Supports presence:subscribe, presence:unsubscribe, presence:query
 * - Broadcasts presence:online / presence:offline to subscribed sockets
 */
class PresenceHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    /** @type {Set<any>} */
    this.sockets = new Set();
    /** @type {Map<any, Set<string>>} */
    this.subscriptions = new Map(); // ws -> Set<userId>
    this.graceMs = parseInt(process.env.PRESENCE_OFFLINE_GRACE_MS || '5000');
  }

  registerEvents(ws) {
    this.sockets.add(ws);
    this.subscriptions.set(ws, new Set());

    ws.on('close', () => {
      this.subscriptions.delete(ws);
      this.sockets.delete(ws);
    });
    ws.on('error', () => {
      this.subscriptions.delete(ws);
      this.sockets.delete(ws);
    });
  }

  // Called by WS server on any user activity (pong/typing/message)
  onActivity(userId) {
    try {
      cache.set(`presence:lastActiveAt:${userId}`, new Date().toISOString(), 24 * 60 * 60);
    } catch (_) {}
  }

  async onUserConnected(userId) {
    try {
      const now = new Date().toISOString();
      cache.set(`presence:online:${userId}`, true, 24 * 60 * 60);
      cache.set(`presence:lastActiveAt:${userId}`, now, 24 * 60 * 60);
      // Clear lastSeen marker when online
      cache.delete(`presence:lastSeen:${userId}`);
      this.broadcastPresence(userId, { type: 'presence:online', data: { userId, onlineSince: now } });
    } catch (e) {
      logger.warn('Presence onUserConnected error', { userId, error: e?.message });
    }
  }

  async onUserDisconnected(userId) {
    try {
      const lastActive = cache.get(`presence:lastActiveAt:${userId}`) || new Date().toISOString();
      // Mark offline after a small grace to smooth reconnections
      setTimeout(() => {
        try {
          if (this.connectionManager.isUserOnline(userId)) return; // Reconnected
          const now = new Date().toISOString();
          cache.delete(`presence:online:${userId}`);
          cache.set(`presence:lastSeen:${userId}`, now, 24 * 60 * 60);
          this.broadcastPresence(userId, { type: 'presence:offline', data: { userId, lastSeen: now, lastActiveAt: lastActive } });
        } catch (e) {
          logger.warn('Presence onUserDisconnected inner error', { userId, error: e?.message });
        }
      }, this.graceMs);
    } catch (e) {
      logger.warn('Presence onUserDisconnected error', { userId, error: e?.message });
    }
  }

  async handleSubscribe(ws, payload) {
    try {
      const requesterId = ws.userId;
      if (!requesterId) {
        this.safeSend(ws, { type: 'error', error: 'Unauthorized', timestamp: new Date().toISOString() });
        return;
      }

      const ids = Array.isArray(payload?.userIds) ? payload.userIds.map(String) : [];
      
      // Validação: usuário só pode se inscrever para presença de participantes autorizados
      const authorizedIds = await this.getAuthorizedUserIds(requesterId, ids);
      
      if (authorizedIds.length === 0) {
        this.safeSend(ws, { type: 'presence:snapshot', data: { statuses: [] } });
        return;
      }
      
      const set = this.subscriptions.get(ws) || new Set();
      authorizedIds.forEach(id => set.add(String(id)));
      this.subscriptions.set(ws, set);
      
      // Send immediate snapshot (apenas IDs autorizados)
      const statuses = authorizedIds.map(id => this.getStatus(id));
      this.safeSend(ws, { type: 'presence:snapshot', data: { statuses } });
    } catch (e) {
      logger.error('presence:subscribe error', { error: e.message });
      this.safeSend(ws, { type: 'error', error: 'presence:subscribe failed', timestamp: new Date().toISOString() });
    }
  }

  handleUnsubscribe(ws, payload) {
    try {
      const ids = Array.isArray(payload?.userIds) ? payload.userIds.map(String) : [];
      const set = this.subscriptions.get(ws) || new Set();
      ids.forEach(id => set.delete(String(id)));
      this.subscriptions.set(ws, set);
      this.safeSend(ws, { type: 'presence:unsubscribed', data: { userIds: ids } });
    } catch (e) {
      this.safeSend(ws, { type: 'error', error: 'presence:unsubscribe failed', timestamp: new Date().toISOString() });
    }
  }

  async handleQuery(ws, payload) {
    try {
      const requesterId = ws.userId;
      if (!requesterId) {
        this.safeSend(ws, { type: 'error', error: 'Unauthorized', timestamp: new Date().toISOString() });
        return;
      }

      const ids = Array.isArray(payload?.userIds) ? payload.userIds.map(String) : [];
      
      // Validação: usuário só pode consultar presença de participantes de suas conversas
      const authorizedIds = await this.getAuthorizedUserIds(requesterId, ids);
      
      if (authorizedIds.length === 0) {
        this.safeSend(ws, { type: 'presence:snapshot', data: { statuses: [] } });
        return;
      }
      
      // Retornar apenas status de usuários autorizados
      const statuses = authorizedIds.map(id => this.getStatus(id));
      this.safeSend(ws, { type: 'presence:snapshot', data: { statuses } });
    } catch (e) {
      logger.error('presence:query error', { error: e.message });
      this.safeSend(ws, { type: 'error', error: 'presence:query failed', timestamp: new Date().toISOString() });
    }
  }
  
  /**
   * Retorna apenas IDs de usuários que o requester tem permissão de ver
   * (participantes de conversas em comum)
   */
  async getAuthorizedUserIds(requesterId, requestedIds) {
    try {
      if (!requestedIds || requestedIds.length === 0) return [];
      
      // Buscar conversas onde o requester é participante
      const conversations = await Conversation.find({
        participants: requesterId
      }).select('participants').lean();
      
      // Extrair todos os participantes de conversas em comum
      const authorizedSet = new Set();
      conversations.forEach(conv => {
        if (conv.participants && Array.isArray(conv.participants)) {
          conv.participants.forEach(p => {
            const pId = p._id?.toString() || p.toString();
            authorizedSet.add(pId);
          });
        }
      });
      
      // Filtrar apenas IDs requisitados que estão autorizados
      return requestedIds.filter(id => authorizedSet.has(id.toString()));
    } catch (error) {
      logger.error('getAuthorizedUserIds error', { error: error.message });
      return [];
    }
  }

  getStatus(userId) {
    try {
      const online = !!this.connectionManager.isUserOnline(userId);
      const lastSeen = online ? null : (cache.get(`presence:lastSeen:${userId}`) || null);
      const lastActiveAt = cache.get(`presence:lastActiveAt:${userId}`) || null;
      return { userId: String(userId), online, lastSeen, lastActiveAt };
    } catch (_) {
      return { userId: String(userId), online: false, lastSeen: null, lastActiveAt: null };
    }
  }

  broadcastPresence(userId, message) {
    try {
      for (const ws of this.sockets) {
        const subs = this.subscriptions.get(ws);
        if (!subs || !subs.has(String(userId))) continue;
        this.safeSend(ws, message);
      }
    } catch (e) {
      logger.warn('broadcastPresence failed', { error: e?.message });
    }
  }

  safeSend(ws, obj) {
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch (_) {}
  }
}

module.exports = PresenceHandler;

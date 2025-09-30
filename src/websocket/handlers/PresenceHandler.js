const cache = require('../../services/GlobalCache');
const logger = require('../../utils/logger');

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
    this.graceMs = parseInt(process.env.PRESENCE_OFFLINE_GRACE_MS || '20000');
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

  handleSubscribe(ws, payload) {
    try {
      const ids = Array.isArray(payload?.userIds) ? payload.userIds.map(String) : [];
      const set = this.subscriptions.get(ws) || new Set();
      ids.forEach(id => set.add(String(id)));
      this.subscriptions.set(ws, set);
      // Send immediate snapshot
      const statuses = ids.map(id => this.getStatus(id));
      this.safeSend(ws, { type: 'presence:snapshot', data: { statuses } });
    } catch (e) {
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

  handleQuery(ws, payload) {
    try {
      const ids = Array.isArray(payload?.userIds) ? payload.userIds.map(String) : [];
      const statuses = ids.map(id => this.getStatus(id));
      this.safeSend(ws, { type: 'presence:snapshot', data: { statuses } });
    } catch (e) {
      this.safeSend(ws, { type: 'error', error: 'presence:query failed', timestamp: new Date().toISOString() });
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

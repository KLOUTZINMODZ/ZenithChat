const webpush = require('web-push');
const logger = require('../utils/logger');
const PushSubscription = require('../models/PushSubscription');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@example.com';

let vapidConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
  } catch (e) {
    logger.warn('[PUSH] Failed to configure VAPID keys:', e?.message);
  }
} else {
  logger.warn('[PUSH] VAPID keys not set. Configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable push.');
}

const pushService = {
  isConfigured() {
    return vapidConfigured;
  },

  getPublicKey() {
    return VAPID_PUBLIC_KEY;
  },

  async saveSubscription(userId, subscription, userAgent) {
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      throw new Error('Invalid subscription');
    }

    const payload = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      },
      userAgent: userAgent || null,
      userId,
      active: true
    };

    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      payload,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  },

  async removeSubscription(userId, endpoint) {
    if (!endpoint) return;
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { active: false, userId },
      { new: true }
    );
  },

  async sendToUser(userId, payload) {
    if (!this.isConfigured()) {
      logger.debug('[PUSH] VAPID not configured; skipping push send.');
      return { sent: 0, failed: 0 };
    }

    const subs = await PushSubscription.find({ userId, active: true }).lean();
    if (!subs.length) {
      return { sent: 0, failed: 0 };
    }

    const results = { sent: 0, failed: 0 };
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, JSON.stringify(payload));
          results.sent += 1;
        } catch (err) {
          results.failed += 1;
          const statusCode = err?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            try {
              await PushSubscription.findOneAndUpdate(
                { endpoint: sub.endpoint },
                { active: false }
              );
            } catch (_) {}
          }
          logger.debug('[PUSH] send failed:', err?.message);
        }
      })
    );

    return results;
  }
};

module.exports = pushService;

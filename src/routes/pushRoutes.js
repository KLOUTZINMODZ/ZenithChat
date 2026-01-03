const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const pushService = require('../services/pushService');

router.get('/public-key', (req, res) => {
  const key = pushService.getPublicKey();
  if (!key) {
    return res.status(503).json({ success: false, message: 'Push service not configured' });
  }
  return res.json({ success: true, publicKey: key });
});

router.post('/subscribe', auth, async (req, res) => {
  try {
    const { subscription, userAgent } = req.body || {};
    if (!subscription) {
      return res.status(400).json({ success: false, message: 'subscription is required' });
    }
    await pushService.saveSubscription(req.user.id, subscription, userAgent);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to save subscription' });
  }
});

router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ success: false, message: 'endpoint is required' });
    }
    await pushService.removeSubscription(req.user.id, endpoint);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to remove subscription' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const influencerController = require('../controllers/InfluencerController');
const mongoose = require('mongoose');

// Helper middleware to require admin key (same as in adminRoutes.js)
function requireAdminKey(req, res, next) {
    try {
        const normalize = (v) => (v == null ? '' : String(v).trim());
        const headerPanel = normalize(req.headers['x-panel-proxy-secret']);
        const headerAdmin = normalize(req.headers['x-admin-key'] || req.headers['x-api-key']);
        const panelSecret = normalize(process.env.PANEL_PROXY_SECRET || '');
        const adminKey = normalize(process.env.ADMIN_API_KEY || '');

        // Allow trusted origin without additional headers
        const origin = normalize(req.headers.origin || req.headers.referer || '');
        const TRUSTED_ORIGINS = ['https://zenithpaineladm.vercel.app'];
        if (TRUSTED_ORIGINS.some((o) => origin.startsWith(o))) {
            return next();
        }

        if (panelSecret && headerPanel && headerPanel === panelSecret) {
            return next();
        }
        if (adminKey && headerAdmin && headerAdmin === adminKey) {
            return next();
        }

        return res.status(403).json({ success: false, message: 'Acesso negado' });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Erro na verificação de chave de admin', error: e?.message });
    }
}

// Admin Routes
router.get('/', requireAdminKey, influencerController.getInfluencers);
router.get('/search', requireAdminKey, influencerController.searchUsers);
router.patch('/:userId', requireAdminKey, influencerController.updateInfluencer);
router.get('/:userId/stats', requireAdminKey, influencerController.getInfluencerStats);

module.exports = router;

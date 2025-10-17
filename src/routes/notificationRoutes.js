const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

function requireAdminKey(req, res, next) {
  try {
    const normalize = (v) => (v == null ? '' : String(v).trim());
    const headerPanel = normalize(req.headers['x-panel-proxy-secret']);
    const headerAdmin = normalize(req.headers['x-admin-key'] || req.headers['x-api-key']);
    const panelSecret = normalize(process.env.PANEL_PROXY_SECRET || '');
    const adminKey = normalize(process.env.ADMIN_API_KEY || '');
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
    try { require('../utils/logger').warn('[NOTIF][AUTH] Access denied: panelHeaderPresent=%s adminHeaderPresent=%s', !!headerPanel, !!headerAdmin); } catch (_) {}
    return res.status(403).json({ success: false, message: 'Acesso negado' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Erro na verificação de chave de admin', error: e?.message });
  }
}

/**
 * POST /api/notifications/send
 * Body: {
 *   userIds: string[] | string,
 *   notification: {...},
 *   options?: {...}
 * }
 *
 * Requires that server.js has set app.locals.notificationService
 */
router.post('/send', requireAdminKey, async (req, res) => {
  try {
    const { userIds, notification, options = {} } = req.body;

    if (!notification) {
      return res.status(400).json({ success: false, message: 'notification is required' });
    }

    let idsArray = [];
    const broadcastAll = options?.broadcastAll === true || userIds === '__all__';
    if (broadcastAll) {
      const users = await User.find({}).select('_id').lean();
      idsArray = users.map(u => String(u._id));
      if (!idsArray.length) {
        return res.status(404).json({ success: false, message: 'No users found to broadcast' });
      }
    } else {
      if (!userIds) {
        return res.status(400).json({ success: false, message: 'userIds is required when not broadcasting to all' });
      }
      idsArray = (Array.isArray(userIds) ? userIds : [userIds]).map(String);
    }

    const notificationService = req.app.locals.notificationService;
    if (!notificationService) {
      logger.error('Notification service not initialized in app.locals');
      return res.status(500).json({ success: false, message: 'Notification service unavailable' });
    }

    const results = await notificationService.broadcastNotification(idsArray, notification, options);
    res.json({ success: true, results });
  } catch (error) {
    logger.error('Error in /api/notifications/send:', error);
    res.status(500).json({ success: false, message: 'Internal error' });
  }
});

// GET /api/notifications/preferences - Obter preferências do usuário
router.get('/preferences', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('preferences').lean();
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }

    // Garantir que os defaults sejam aplicados se não existirem
    const preferences = {
      preferences: {
        newProposal: user.preferences?.notifications?.newProposal ?? true,
        proposalAccepted: user.preferences?.notifications?.proposalAccepted ?? true,
        newBoosting: user.preferences?.notifications?.newBoosting ?? false,
        boostingCompleted: user.preferences?.notifications?.boostingCompleted ?? true
      },
      watchedGames: user.preferences?.watchedGames || [],
      watchedGameIds: user.preferences?.watchedGameIds || [],
      emailNotifications: user.preferences?.emailNotifications ?? true
    };

    res.json({ success: true, data: preferences });
  } catch (error) {
    logger.error('Error getting notification preferences:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar preferências' });
  }
});

// PUT /api/notifications/preferences - Atualizar preferências do usuário
router.put('/preferences', auth, async (req, res) => {
  try {
    const { preferences, watchedGames, watchedGameIds, emailNotifications } = req.body;

    logger.info('=== ATUALIZAÇÃO DE PREFERÊNCIAS ===');
    logger.info(`Usuário: ${req.user.id}`);
    logger.info(`emailNotifications recebido: ${emailNotifications} (${typeof emailNotifications})`);
    logger.info(`Body completo:`, JSON.stringify(req.body, null, 2));

    const updateData = {};
    
    if (preferences) {
      if (preferences.newProposal !== undefined) {
        updateData['preferences.notifications.newProposal'] = preferences.newProposal;
      }
      if (preferences.proposalAccepted !== undefined) {
        updateData['preferences.notifications.proposalAccepted'] = preferences.proposalAccepted;
      }
      if (preferences.newBoosting !== undefined) {
        updateData['preferences.notifications.newBoosting'] = preferences.newBoosting;
      }
      if (preferences.boostingCompleted !== undefined) {
        updateData['preferences.notifications.boostingCompleted'] = preferences.boostingCompleted;
      }
    }

    if (watchedGames !== undefined) {
      updateData['preferences.watchedGames'] = watchedGames;
    }
    
    if (watchedGameIds !== undefined) {
      updateData['preferences.watchedGameIds'] = watchedGameIds;
    }

    if (emailNotifications !== undefined) {
      updateData['preferences.emailNotifications'] = emailNotifications;
      logger.info(`✓ emailNotifications será atualizado para: ${emailNotifications}`);
    } else {
      logger.warn(`⚠ emailNotifications NÃO foi enviado no body!`);
    }

    logger.info(`Dados a serem atualizados:`, JSON.stringify(updateData, null, 2));

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('preferences');

    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }

    logger.info(`✓ Usuário atualizado com sucesso!`);
    logger.info(`emailNotifications salvo no banco: ${user.preferences?.emailNotifications} (${typeof user.preferences?.emailNotifications})`);
    logger.info(`Preferences completo:`, JSON.stringify(user.preferences, null, 2));

    const responseData = {
      preferences: {
        newProposal: user.preferences?.notifications?.newProposal ?? true,
        proposalAccepted: user.preferences?.notifications?.proposalAccepted ?? true,
        newBoosting: user.preferences?.notifications?.newBoosting ?? false,
        boostingCompleted: user.preferences?.notifications?.boostingCompleted ?? true
      },
      watchedGames: user.preferences?.watchedGames || [],
      watchedGameIds: user.preferences?.watchedGameIds || [],
      emailNotifications: user.preferences?.emailNotifications ?? true
    };

    logger.info('=== FIM DA ATUALIZAÇÃO ===\n');

    res.json({ success: true, message: 'Preferências atualizadas com sucesso', data: responseData });
  } catch (error) {
    logger.error('Error updating notification preferences:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar preferências' });
  }
});

module.exports = router;

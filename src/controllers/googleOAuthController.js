const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const googleOAuthService = require('../services/GoogleOAuthService');

// Store para states temporários (em produção, usar Redis)
const stateStore = new Map();

// Limpeza automática de states expirados (a cada 5 minutos)
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of stateStore.entries()) {
    if (now > data.expiresAt) {
      stateStore.delete(state);
    }
  }
}, 5 * 60 * 1000);

/**
 * Inicia o fluxo OAuth - gera URL de autorização
 * GET /api/auth/google/login
 */
exports.initiateGoogleLogin = async (req, res) => {
  try {
    // Gera state único para CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Armazena state com timestamp de expiração (10 minutos)
    stateStore.set(state, {
      createdAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000),
      ip: req.ip
    });

    // Gera URL de autorização
    const authUrl = googleOAuthService.getAuthUrl(state);

    logger.info('Google OAuth initiated', {
      state,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      data: {
        authUrl,
        state // Frontend deve armazenar para validação
      }
    });
  } catch (error) {
    logger.error('Error initiating Google OAuth:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate Google authentication',
      error: error.message
    });
  }
};

/**
 * Callback OAuth - processa código de autorização
 * GET /api/auth/google/callback?code=xxx&state=xxx
 */
exports.handleGoogleCallback = async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    // Verifica se houve erro no OAuth
    if (oauthError) {
      logger.warn('Google OAuth error:', oauthError);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_cancelled`);
    }

    // Valida presença de code e state
    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_request`);
    }

    // Valida state (CSRF protection)
    const stateData = stateStore.get(state);
    if (!stateData) {
      logger.warn('Invalid or expired OAuth state', { state, ip: req.ip });
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
    }

    // Remove state usado (one-time use)
    stateStore.delete(state);

    // Troca code por tokens
    const tokens = await googleOAuthService.getTokensFromCode(code);

    // Valida e extrai informações do id_token
    const googleUser = await googleOAuthService.verifyIdToken(tokens.id_token);

    logger.info('Google user verified', {
      googleId: googleUser.googleId,
      email: googleUser.email,
      emailVerified: googleUser.emailVerified
    });

    // Procura usuário existente por googleId ou email
    let user = await User.findOne({
      $or: [
        { googleId: googleUser.googleId },
        { email: googleUser.email }
      ]
    });

    let isNewUser = false;
    let requiresPhoneSetup = false;

    if (user) {
      // Usuário existente
      if (!user.googleId && user.authProvider === 'local') {
        // Email já cadastrado com auth local
        logger.warn('Email already registered with local auth', {
          email: googleUser.email
        });
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=email_exists`);
      }

      // Atualiza dados do Google se necessário
      if (user.googleId) {
        user.googleProfile = {
          picture: googleUser.picture,
          locale: googleUser.locale,
          given_name: googleUser.givenName,
          family_name: googleUser.familyName
        };
        user.emailVerified = true;
        await user.save();
      }
    } else {
      // Novo usuário - cria registro parcial
      isNewUser = true;
      requiresPhoneSetup = true;

      user = new User({
        googleId: googleUser.googleId,
        email: googleUser.email,
        name: googleUser.name,
        authProvider: 'google',
        emailVerified: true,
        requiresPhoneSetup: true,
        googleProfile: {
          picture: googleUser.picture,
          locale: googleUser.locale,
          given_name: googleUser.givenName,
          family_name: googleUser.familyName
        },
        role: 'user',
        isActive: true
      });

      await user.save();

      logger.info('New Google user created', {
        userId: user._id,
        email: user.email,
        requiresPhoneSetup: true
      });
    }

    // Gera JWT
    const jwtPayload = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      requiresPhoneSetup: user.requiresPhoneSetup || false
    };

    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, {
      expiresIn: requiresPhoneSetup ? '15m' : '7d' // Token temporário se precisa telefone
    });

    // Redireciona para frontend com token
    const redirectUrl = requiresPhoneSetup
      ? `${process.env.FRONTEND_URL}/auth/setup-phone?token=${token}`
      : `${process.env.FRONTEND_URL}/auth/success?token=${token}`;

    res.redirect(redirectUrl);

  } catch (error) {
    logger.error('Error handling Google callback:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }
};

/**
 * Completa o setup adicionando telefone
 * POST /api/auth/google/complete-setup
 * Body: { phone: "+5511999999999" }
 * Headers: { Authorization: "Bearer temp_token" }
 */
exports.completePhoneSetup = async (req, res) => {
  try {
    const { phone } = req.body;

    // Valida token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token não fornecido'
      });
    }

    // Decodifica token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Token inválido ou expirado'
      });
    }

    // Verifica se requer phone setup
    if (!decoded.requiresPhoneSetup) {
      return res.status(400).json({
        success: false,
        message: 'Phone setup não requerido'
      });
    }

    // Valida telefone
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Telefone inválido'
      });
    }

    // Normaliza telefone (remove caracteres especiais)
    const normalizedPhone = phone.replace(/\D/g, '');

    // Valida formato brasileiro (55 + DDD + número)
    if (!/^55\d{10,11}$/.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de telefone inválido. Use: +55 (XX) XXXXX-XXXX'
      });
    }

    // Busca usuário
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // Atualiza telefone e remove flag de setup
    user.phone = normalizedPhone;
    user.phoneNumber = normalizedPhone;
    user.phoneNormalized = normalizedPhone;
    user.requiresPhoneSetup = false;
    await user.save();

    logger.info('Phone setup completed', {
      userId: user._id,
      email: user.email,
      phone: normalizedPhone
    });

    // Gera novo token completo (7 dias)
    const finalToken = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        requiresPhoneSetup: false
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Telefone adicionado com sucesso',
      data: {
        token: finalToken,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          avatar: user.googleProfile?.picture || null
        }
      }
    });

  } catch (error) {
    logger.error('Error completing phone setup:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao completar cadastro',
      error: error.message
    });
  }
};

/**
 * Desvincula conta Google
 * POST /api/auth/google/unlink
 * Headers: { Authorization: "Bearer token" }
 */
exports.unlinkGoogle = async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token não fornecido'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // Não permite desvincular se for único método de auth
    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        message: 'Configure uma senha antes de desvincular conta Google'
      });
    }

    user.googleId = undefined;
    user.googleProfile = undefined;
    user.authProvider = 'local';
    await user.save();

    logger.info('Google account unlinked', {
      userId: user._id,
      email: user.email
    });

    res.json({
      success: true,
      message: 'Conta Google desvinculada com sucesso'
    });

  } catch (error) {
    logger.error('Error unlinking Google account:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao desvincular conta',
      error: error.message
    });
  }
};

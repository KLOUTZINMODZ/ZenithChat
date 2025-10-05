const EmailVerification = require('../models/EmailVerification');
const User = require('../models/User');
const { isEmailFromTrustedProvider, getUntrustedEmailMessage } = require('../config/trustedEmailProviders');
const logger = require('../utils/logger');

/**
 * Gera código de 6 dígitos
 */
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /api/auth/send-verification-code
 * Envia código de verificação para email
 */
exports.sendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email é obrigatório'
      });
    }

    const emailLower = email.toLowerCase().trim();

    // Validar provedor confiável
    if (!isEmailFromTrustedProvider(emailLower)) {
      return res.status(400).json({
        success: false,
        message: getUntrustedEmailMessage(emailLower),
        error: 'UNTRUSTED_EMAIL_PROVIDER'
      });
    }

    // Verificar se email já está cadastrado
    const existingUser = await User.findOne({ email: emailLower });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Este email já está cadastrado',
        error: 'EMAIL_ALREADY_EXISTS'
      });
    }

    // Limitar envios (máximo 3 códigos por hora)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCodes = await EmailVerification.countDocuments({
      email: emailLower,
      createdAt: { $gte: oneHourAgo }
    });

    if (recentCodes >= 3) {
      return res.status(429).json({
        success: false,
        message: 'Muitas tentativas. Aguarde 1 hora.',
        error: 'TOO_MANY_REQUESTS'
      });
    }

    // Gerar código
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Salvar no banco
    await EmailVerification.create({
      email: emailLower,
      code,
      expiresAt,
      verified: false,
      attempts: 0
    });

    // Enviar email
    const emailService = require('../services/emailService');
    await emailService.sendVerificationCode(emailLower, code);

    logger.info(`Verification code sent to: ${emailLower}`);

    res.json({
      success: true,
      message: 'Código enviado para seu email',
      expiresIn: 900 // 15 minutos em segundos
    });

  } catch (error) {
    logger.error('Error sending verification code:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao enviar código de verificação'
    });
  }
};

/**
 * POST /api/auth/verify-email-code
 * Verifica código de verificação
 */
exports.verifyEmailCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'Email e código são obrigatórios'
      });
    }

    const emailLower = email.toLowerCase().trim();
    const codeStr = code.toString().trim();

    // Buscar verificação
    const verification = await EmailVerification.findOne({
      email: emailLower,
      verified: false
    }).sort({ createdAt: -1 }); // Pegar o mais recente

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: 'Código não encontrado ou já foi usado',
        error: 'CODE_NOT_FOUND'
      });
    }

    // Verificar expiração
    if (new Date() > verification.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Código expirado. Solicite um novo.',
        error: 'CODE_EXPIRED'
      });
    }

    // Verificar tentativas (máximo 5)
    if (verification.attempts >= 5) {
      return res.status(400).json({
        success: false,
        message: 'Muitas tentativas incorretas. Solicite um novo código.',
        error: 'TOO_MANY_ATTEMPTS'
      });
    }

    // Verificar código
    if (verification.code !== codeStr) {
      verification.attempts += 1;
      await verification.save();

      return res.status(400).json({
        success: false,
        message: `Código incorreto. ${5 - verification.attempts} tentativas restantes.`,
        error: 'INVALID_CODE',
        attemptsLeft: 5 - verification.attempts
      });
    }

    // Código correto!
    verification.verified = true;
    await verification.save();

    logger.info(`Email verified successfully: ${emailLower}`);

    res.json({
      success: true,
      message: 'Email verificado com sucesso!',
      verificationToken: verification._id.toString() // Token para usar no registro
    });

  } catch (error) {
    logger.error('Error verifying email code:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar código'
    });
  }
};

/**
 * POST /api/auth/resend-verification-code
 * Reenvia código de verificação
 */
exports.resendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email é obrigatório'
      });
    }

    const emailLower = email.toLowerCase().trim();

    // Verificar última tentativa (mínimo 60 segundos entre envios)
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentCode = await EmailVerification.findOne({
      email: emailLower,
      createdAt: { $gte: oneMinuteAgo }
    });

    if (recentCode) {
      return res.status(429).json({
        success: false,
        message: 'Aguarde 60 segundos antes de solicitar novo código',
        error: 'TOO_SOON'
      });
    }

    // Reutilizar a função de envio
    return exports.sendVerificationCode(req, res);

  } catch (error) {
    logger.error('Error resending verification code:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao reenviar código'
    });
  }
};

module.exports = exports;

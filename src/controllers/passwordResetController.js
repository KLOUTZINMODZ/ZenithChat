const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');

/**
 * Gera código de 8 dígitos aleatório
 */
function generateResetCode() {
  return crypto.randomInt(10000000, 99999999).toString();
}

/**
 * Rate limiting simples baseado em IP
 */
const rateLimiter = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const requests = rateLimiter.get(ip) || [];
  
  // Remove requisições antigas (> 1 hora)
  const recentRequests = requests.filter(time => now - time < 3600000);
  
  // Máximo 3 requisições por hora
  if (recentRequests.length >= 3) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimiter.set(ip, recentRequests);
  return true;
}

/**
 * Solicitar recuperação de senha
 */
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    // Validação do email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Email inválido'
      });
    }

    // Verificar provedor confiável
    if (!emailService.isValidEmailProvider(email)) {
      return res.status(400).json({
        success: false,
        message: 'Por favor, use um email de um provedor confiável (Gmail, Outlook, Yahoo, etc.)'
      });
    }

    // Rate limiting
    if (!checkRateLimit(ipAddress)) {
      return res.status(429).json({
        success: false,
        message: 'Muitas tentativas. Tente novamente em 1 hora.'
      });
    }

    // Buscar usuário
    const user = await User.findOne({ email: email.toLowerCase() });
    
    // Por segurança, sempre retorna sucesso mesmo se usuário não existir
    // Isso previne enumeração de emails
    if (!user) {
      logger.warn(`Password reset requested for non-existent email: ${email}`);
      return res.json({
        success: true,
        message: 'Se este email estiver cadastrado, você receberá um código de recuperação.'
      });
    }

    // Invalidar códigos anteriores
    await PasswordReset.updateMany(
      { userId: user._id, used: false },
      { used: true }
    );

    // Gerar novo código
    const code = generateResetCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Salvar código no banco
    const passwordReset = new PasswordReset({
      userId: user._id,
      email: email.toLowerCase(),
      code,
      expiresAt,
      ipAddress,
      userAgent
    });

    await passwordReset.save();

    // Enviar email
    try {
      await emailService.sendPasswordResetEmail(email, code, user.name);
      
      logger.info(`Password reset code sent to ${email}`);
      
      res.json({
        success: true,
        message: 'Código de recuperação enviado para seu email!',
        data: {
          expiresIn: 900 // 15 minutos em segundos
        }
      });
    } catch (emailError) {
      logger.error('Failed to send reset email:', emailError);
      
      // Deletar o código se o email falhou
      await PasswordReset.deleteOne({ _id: passwordReset._id });
      
      res.status(500).json({
        success: false,
        message: 'Erro ao enviar email.'
      });
    }

  } catch (error) {
    logger.error('Error in requestPasswordReset:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao processar solicitação'
    });
  }
};

/**
 * Verificar código de recuperação
 */
exports.verifyResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'Email e código são obrigatórios'
      });
    }

    // Buscar código
    const resetRequest = await PasswordReset.findOne({
      email: email.toLowerCase(),
      code: code.trim(),
      used: false
    }).sort({ createdAt: -1 });

    if (!resetRequest) {
      return res.status(400).json({
        success: false,
        message: 'Código inválido ou expirado'
      });
    }

    // Verificar expiração
    if (resetRequest.isExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Código expirado. Solicite um novo código.'
      });
    }

    // Verificar tentativas
    if (!resetRequest.canAttempt()) {
      await PasswordReset.updateOne(
        { _id: resetRequest._id },
        { used: true }
      );
      
      return res.status(400).json({
        success: false,
        message: 'Muitas tentativas. Solicite um novo código.'
      });
    }

    // Incrementar tentativas
    resetRequest.attempts += 1;
    await resetRequest.save();

    res.json({
      success: true,
      message: 'Código verificado com sucesso!',
      data: {
        resetToken: resetRequest._id.toString() // Token temporário para a próxima etapa
      }
    });

  } catch (error) {
    logger.error('Error in verifyResetCode:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar código'
    });
  }
};

/**
 * Redefinir senha
 */
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token e nova senha são obrigatórios'
      });
    }

    // Validar senha forte
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'A senha deve ter no mínimo 6 caracteres'
      });
    }

    // Buscar resetRequest
    const resetRequest = await PasswordReset.findById(resetToken);

    if (!resetRequest || resetRequest.used) {
      return res.status(400).json({
        success: false,
        message: 'Token inválido ou já utilizado'
      });
    }

    if (resetRequest.isExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Token expirado'
      });
    }

    // Buscar usuário
    const user = await User.findById(resetRequest.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // Hash da nova senha
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Atualizar senha no banco do chat
    user.password = hashedPassword;
    await user.save();

    // CRÍTICO: Sincronizar senha com HackLoteAPI (banco principal)
    try {
      const mainApiUrl = process.env.VERCEL_API_URL || 'https://zenithggapi.vercel.app';
      const adminSecret = process.env.VERCEL_API_SECRET || 'default_secret';
      
      console.log(`[SYNC] Tentando sincronizar senha para ${user.email} com ${mainApiUrl}/api/v1/admin/sync-password`);
      
      const response = await axios.post(`${mainApiUrl}/api/v1/admin/sync-password`, {
        email: user.email,
        hashedPassword: hashedPassword
      }, {
        headers: {
          'X-Admin-Secret': adminSecret
        },
        timeout: 5000
      });
      
      console.log(`[SYNC] Senha sincronizada com sucesso: ${response.data.message}`);
      logger.info(`Password synced to main API for user: ${user.email}`);
    } catch (syncError) {
      console.error(`[SYNC] ❌ Erro ao sincronizar senha para ${user.email}:`, {
        message: syncError.message,
        response: syncError.response?.data,
        status: syncError.response?.status,
        url: syncError.config?.url
      });
      logger.error(`Failed to sync password to main API for ${user.email}:`, syncError.message);
      // NÃO falhar o reset mesmo se sincronização falhar
      // Usuário pode fazer reset novamente se necessário
    }

    // Marcar código como usado
    resetRequest.used = true;
    await resetRequest.save();

    // Invalidar todos os outros códigos
    await PasswordReset.updateMany(
      { userId: user._id, _id: { $ne: resetRequest._id } },
      { used: true }
    );

    logger.info(`Password reset successful for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Senha redefinida com sucesso! Você já pode fazer login.'
    });

  } catch (error) {
    logger.error('Error in resetPassword:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao redefinir senha'
    });
  }
};

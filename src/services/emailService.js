const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialize();
  }

  initialize() {
    try {
      // Configuração do Gmail usando OAuth2 ou App Password
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER, // Seu email do Gmail
          pass: process.env.EMAIL_PASSWORD // Senha de app do Gmail
        },
        secure: true,
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verificar conexão
      this.transporter.verify((error) => {
        if (error) {
          logger.error('Email service configuration error:', error);
        } else {
          logger.info('Email service ready to send emails');
        }
      });
    } catch (error) {
      logger.error('Failed to initialize email service:', error);
    }
  }

  /**
   * Envia email de recuperação de senha
   */
  async sendPasswordResetEmail(email, code, userName) {
    try {
      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      const mailOptions = {
        from: {
          name: 'Zenith - Recuperação de Senha',
          address: process.env.EMAIL_USER
        },
        to: email,
        subject: '🎮 Zenith - Código de Recuperação de Senha',
        html: this.getPasswordResetTemplate(code, userName)
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Password reset email sent to ${email}:`, info.messageId);
      
      return {
        success: true,
        messageId: info.messageId
      };
    } catch (error) {
      logger.error('Error sending password reset email:', error);
      throw error;
    }
  }

  /**
   * Envia email de verificação de conta
   */
  async sendVerificationCode(email, code) {
    try {
      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      const mailOptions = {
        from: {
          name: 'Zenith Gaming - Verificação',
          address: process.env.EMAIL_USER
        },
        to: email,
        subject: '🎮 Zenith - Código de Verificação',
        html: this.getVerificationCodeTemplate(code)
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Verification email sent to ${email}:`, info.messageId);
      
      return {
        success: true,
        messageId: info.messageId
      };
    } catch (error) {
      logger.error('Error sending verification email:', error);
      throw error;
    }
  }

  /**
   * Template HTML para o email de verificação
   */
  getVerificationCodeTemplate(code) {
    return `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Zenith - Verificação de Email</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #0a0e1a;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="max-width: 600px; width: 100%; background: #111827; border: 1px solid #1f2937; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); overflow: hidden;">
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 40px 30px; text-align: center; border-bottom: 2px solid #3b82f6;">
                    <div style="display: inline-block; padding: 8px 20px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 20px; margin-bottom: 15px;">
                      <span style="color: #3b82f6; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;">🎮 Zenith Gaming</span>
                    </div>
                    
                    <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: bold; text-shadow: 0 0 20px rgba(59, 130, 246, 0.5);">
                      ✉️ Verificação de Email
                    </h1>
                    <p style="margin: 10px 0 0; color: #94a3b8; font-size: 16px;">
                      Seu código de verificação está pronto!
                    </p>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding: 40px 30px; background: #111827;">
                    <p style="margin: 0 0 20px; color: #e2e8f0; font-size: 16px; line-height: 1.6;">
                      Olá Gamer,
                    </p>
                    
                    <p style="margin: 0 0 30px; color: #cbd5e1; font-size: 15px; line-height: 1.6;">
                      Use o código abaixo para verificar seu email e completar o cadastro na plataforma Zenith:
                    </p>

                    <!-- Code Box -->
                    <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 2px solid; border-image: linear-gradient(135deg, #3b82f6, #06b6d4) 1; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; position: relative;">
                      <div style="color: #06b6d4; font-size: 12px; font-weight: 600; letter-spacing: 2px; margin-bottom: 15px; text-transform: uppercase;">
                        ▸ CÓDIGO DE VERIFICAÇÃO
                      </div>
                      <div style="font-size: 42px; font-weight: bold; color: #ffffff; letter-spacing: 8px; font-family: 'Courier New', monospace; text-shadow: 0 0 20px rgba(6, 182, 212, 0.6);">
                        ${code}
                      </div>
                      <div style="color: #64748b; font-size: 13px; margin-top: 15px;">
                        Válido por 15 minutos
                      </div>
                    </div>

                    <div style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 15px 20px; border-radius: 8px; margin: 30px 0;">
                      <p style="margin: 0; color: #fca5a5; font-size: 14px; line-height: 1.6;">
                        <strong style="color: #ef4444;">⚠️ Importante:</strong> Este código expira em 15 minutos. Se você não solicitou este código, ignore este email.
                      </p>
                    </div>

                    <p style="margin: 30px 0 0; color: #cbd5e1; font-size: 15px; line-height: 1.6;">
                      Boas partidas,<br>
                      <strong style="color: #3b82f6;">🎮 Equipe Zenith</strong>
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background: #0f172a; padding: 30px; text-align: center; border-top: 1px solid #1f2937;">
                    <div style="height: 2px; background: linear-gradient(90deg, transparent 0%, #3b82f6 50%, transparent 100%); margin-bottom: 20px;"></div>
                    
                    <p style="margin: 0 0 10px; color: #64748b; font-size: 13px;">
                      Este é um email automático, por favor não responda.
                    </p>
                    
                    <p style="margin: 0; color: #475569; font-size: 12px;">
                      © 2025 <strong style="color: #3b82f6;">Zenith</strong> • Powered by Klouts
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  /**
   * Template HTML para o email de recuperação
   */
  getPasswordResetTemplate(code, userName) {
    return `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Zenith - Recuperação de Senha</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #0a0e1a;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="max-width: 600px; width: 100%; background: #111827; border: 1px solid #1f2937; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); overflow: hidden;">
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 40px 30px; text-align: center; border-bottom: 2px solid #3b82f6;">
                    <div style="display: inline-block; padding: 8px 20px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 20px; margin-bottom: 15px;">
                      <span style="color: #3b82f6; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;">🎮 Zenith Gaming</span>
                    </div>
                    
                    <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: bold; text-shadow: 0 0 20px rgba(59, 130, 246, 0.5);">
                      🔐 Recuperação de Senha
                    </h1>
                    <p style="margin: 10px 0 0; color: #94a3b8; font-size: 16px;">
                      Seu código de acesso está pronto!
                    </p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px; background: #111827;">
                    <p style="margin: 0 0 20px; color: #e2e8f0; font-size: 16px; line-height: 1.6;">
                      Olá <strong style="color: #3b82f6;">${userName || 'Gamer'}</strong>,
                    </p>
                    <p style="margin: 0 0 30px; color: #cbd5e1; font-size: 16px; line-height: 1.6;">
                      Recebemos uma solicitação para redefinir a senha da sua conta Zenith. Use o código abaixo para continuar:
                    </p>
                    
                    <!-- Code Box -->
                    <table role="presentation" style="width: 100%; margin: 0 0 30px;">
                      <tr>
                        <td align="center">
                          <!-- Gaming-style code container -->
                          <div style="position: relative; display: inline-block; padding: 4px; background: linear-gradient(135deg, #3b82f6, #06b6d4); border-radius: 16px;">
                            <div style="background: #1e293b; padding: 25px 45px; border-radius: 13px; position: relative;">
                              <!-- Corner accents -->
                              <div style="position: absolute; top: 10px; left: 10px; width: 8px; height: 8px; border-top: 2px solid #3b82f6; border-left: 2px solid #3b82f6;"></div>
                              <div style="position: absolute; top: 10px; right: 10px; width: 8px; height: 8px; border-top: 2px solid #06b6d4; border-right: 2px solid #06b6d4;"></div>
                              <div style="position: absolute; bottom: 10px; left: 10px; width: 8px; height: 8px; border-bottom: 2px solid #3b82f6; border-left: 2px solid #3b82f6;"></div>
                              <div style="position: absolute; bottom: 10px; right: 10px; width: 8px; height: 8px; border-bottom: 2px solid #06b6d4; border-right: 2px solid #06b6d4;"></div>
                              
                              <p style="margin: 0; color: #06b6d4; font-size: 11px; text-transform: uppercase; letter-spacing: 3px; font-weight: 700;">
                                ▸ CÓDIGO DE ACESSO
                              </p>
                              <p style="margin: 12px 0 0; color: #ffffff; font-size: 42px; font-weight: bold; letter-spacing: 10px; font-family: 'Courier New', monospace; text-shadow: 0 0 20px rgba(59, 130, 246, 0.6);">
                                ${code}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Security Info -->
                    <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-left: 4px solid #ef4444; padding: 16px 20px; border-radius: 8px; margin: 0 0 30px;">
                      <p style="margin: 0; color: #fca5a5; font-size: 14px; line-height: 1.5;">
                        ⚠️ <strong style="color: #fecaca;">Importante:</strong> Este código expira em <strong style="color: #fecaca;">15 minutos</strong> e só pode ser usado uma vez. Não compartilhe com ninguém!
                      </p>
                    </div>
                    
                    <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px; line-height: 1.6;">
                      Se você não solicitou a recuperação de senha, ignore este email ou entre em contato com nosso suporte.
                    </p>
                    <p style="margin: 0; color: #94a3b8; font-size: 14px; line-height: 1.6;">
                      Boas partidas,<br>
                      <strong style="color: #3b82f6;">🎮 Equipe Zenith</strong>
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background: #0f172a; padding: 30px; text-align: center; border-top: 1px solid #1f2937;">
                    <!-- Top accent line -->
                    <div style="margin: 0 auto 20px; width: 50px; height: 2px; background: linear-gradient(90deg, #3b82f6, #06b6d4);"></div>
                    
                    <p style="margin: 0 0 10px; color: #64748b; font-size: 13px;">
                      Este é um email automático, por favor não responda.
                    </p>
                    <p style="margin: 0; color: #475569; font-size: 13px;">
                      © ${new Date().getFullYear()} <strong style="color: #3b82f6;">Zenith</strong>. Todos os direitos reservados.
                    </p>
                    <p style="margin: 10px 0 0; color: #334155; font-size: 12px;">
                      Powered by Klouts
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  /**
   * Envia email personalizado para usuários
   */
  async sendCustomEmail(email, userName, subject, templateType, customMessage) {
    try {
      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      const mailOptions = {
        from: {
          name: 'Zenith Gaming',
          address: process.env.EMAIL_USER
        },
        to: email,
        subject: subject,
        html: this.getCustomEmailTemplate(templateType, userName, customMessage)
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Custom email sent to ${email}:`, info.messageId);
      
      return {
        success: true,
        messageId: info.messageId
      };
    } catch (error) {
      logger.error('Error sending custom email:', error);
      throw error;
    }
  }

  /**
   * Template HTML para emails personalizados
   */
  getCustomEmailTemplate(templateType, userName, customMessage) {
    // Ícones SVG personalizados (estilo Lucide)
    const iconMap = {
      warning: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>`,
      news: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V2"></path>
        <path d="M3 13h18"></path>
        <path d="M3 18h18"></path>
        <path d="M10 21h4"></path>
        <rect x="4" y="6" width="16" height="16" rx="2"></rect>
      </svg>`,
      announcement: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path>
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>
        <path d="M4 2C2.8 3.7 2 5.7 2 8"></path>
        <path d="M22 8c0-2.3-.8-4.3-2-6"></path>
      </svg>`
    };

    const titleMap = {
      warning: 'Aviso Importante',
      news: 'Novidades da Plataforma',
      announcement: 'Comunicado Oficial'
    };

    const colorSchemeMap = {
      warning: {
        primary: '#f59e0b',
        secondary: '#ea580c',
        accent: '#fbbf24',
        bg: 'rgba(245, 158, 11, 0.08)',
        gradient: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)'
      },
      news: {
        primary: '#3b82f6',
        secondary: '#06b6d4',
        accent: '#60a5fa',
        bg: 'rgba(59, 130, 246, 0.08)',
        gradient: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)'
      },
      announcement: {
        primary: '#a855f7',
        secondary: '#ec4899',
        accent: '#c084fc',
        bg: 'rgba(168, 85, 247, 0.08)',
        gradient: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)'
      }
    };

    const colors = colorSchemeMap[templateType];

    return `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Zenith - ${titleMap[templateType]}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #0a0e1a;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="max-width: 600px; width: 100%; background: linear-gradient(135deg, #111827 0%, #0f172a 100%); border: 1px solid #1f2937; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.7); overflow: hidden;">
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 50px 30px; text-align: center; border-bottom: 3px solid ${colors.primary};">
                    <!-- Badge Zenith -->
                    <div style="display: inline-block; padding: 10px 20px; background: rgba(59, 130, 246, 0.12); border: 1.5px solid rgba(59, 130, 246, 0.4); border-radius: 20px; margin-bottom: 25px;">
                      <span style="color: #60a5fa; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                          <path d="M12 2L2 7L12 12L22 7L12 2Z"></path>
                          <path d="M2 17L12 22L22 17V12L12 17L2 12V17Z"></path>
                        </svg>
                        Zenith Gaming
                      </span>
                    </div>
                    
                    <!-- Ícone Principal -->
                    <div style="width: 80px; height: 80px; margin: 0 auto 25px; background: ${colors.gradient}; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 8px 32px ${colors.primary}80, 0 0 60px ${colors.primary}40;">
                      <div style="color: #ffffff; filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.5));">
                        ${iconMap[templateType]}
                      </div>
                    </div>
                    
                    <!-- Título -->
                    <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800; text-shadow: 0 2px 20px ${colors.primary}60; letter-spacing: -0.5px;">
                      ${titleMap[templateType]}
                    </h1>
                    
                    <!-- Decoração -->
                    <div style="width: 60px; height: 4px; background: ${colors.gradient}; margin: 20px auto 0; border-radius: 2px;"></div>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding: 45px 35px; background: #111827;">
                    <!-- Saudação -->
                    <p style="margin: 0 0 25px; color: #f1f5f9; font-size: 17px; line-height: 1.6;">
                      Olá <strong style="color: ${colors.primary}; font-weight: 700;">${userName}</strong>,
                    </p>
                    
                    <!-- Mensagem Principal -->
                    <div style="background: ${colors.bg}; border-left: 4px solid ${colors.primary}; border-radius: 12px; padding: 25px; margin: 25px 0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);">
                      <p style="margin: 0; color: #e2e8f0; font-size: 16px; line-height: 1.8;">
                        ${customMessage.replace(/\n/g, '<br>')}
                      </p>
                    </div>

                    <!-- Decoração de Atenção (Warning only) -->
                    ${templateType === 'warning' ? `
                    <div style="background: rgba(239, 68, 68, 0.1); border: 1.5px solid rgba(239, 68, 68, 0.3); border-radius: 12px; padding: 20px; margin: 25px 0; display: flex; align-items: center; gap: 15px;">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      <p style="margin: 0; color: #fca5a5; font-size: 14px; line-height: 1.6;">
                        <strong style="color: #f87171;">Atenção:</strong> Esta mensagem requer sua atenção imediata.
                      </p>
                    </div>
                    ` : ''}

                    <!-- Assinatura -->
                    <div style="margin: 40px 0 0; padding-top: 30px; border-top: 1px solid #1f2937;">
                      <p style="margin: 0 0 8px; color: #94a3b8; font-size: 15px;">
                        ${templateType === 'warning' ? 'Atenciosamente' : templateType === 'announcement' ? 'Com respeito' : 'Boas partidas'},
                      </p>
                      <p style="margin: 0; font-size: 16px; font-weight: 700; color: ${colors.primary}; display: inline-flex; align-items: center; gap: 8px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2L2 7L12 12L22 7L12 2Z"></path>
                          <path d="M2 17L12 22L22 17V12L12 17L2 12V17Z"></path>
                        </svg>
                        Equipe Zenith
                      </p>
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background: #0f172a; padding: 35px; text-align: center; border-top: 1px solid #1f2937;">
                    <div style="height: 3px; background: ${colors.gradient}; margin-bottom: 25px; border-radius: 2px; opacity: 0.6;"></div>
                    
                    <p style="margin: 0 0 12px; color: #64748b; font-size: 13px; line-height: 1.6;">
                      Este é um email automático, por favor não responda.
                    </p>
                    
                    <p style="margin: 0; color: #475569; font-size: 12px;">
                      &copy; 2025 <strong style="color: #60a5fa; font-weight: 600;">Zenith</strong> • Powered by Klouts
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  /**
   * Valida se o email é de um provedor confiável
   */
  isValidEmailProvider(email) {
    const trustedProviders = [
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'yahoo.com',
      'yahoo.com.br',
      'icloud.com',
      'me.com',
      'protonmail.com',
      'proton.me',
      'aol.com',
      'zoho.com',
      'mail.com'
    ];

    const domain = email.toLowerCase().split('@')[1];
    return trustedProviders.includes(domain);
  }
}

module.exports = new EmailService();

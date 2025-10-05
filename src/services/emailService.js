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

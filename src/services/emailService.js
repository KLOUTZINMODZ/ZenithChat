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
          name: 'HackLote - Recuperação de Senha',
          address: process.env.EMAIL_USER
        },
        to: email,
        subject: '🔐 Código de Recuperação de Senha',
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
   * Template HTML para o email de recuperação
   */
  getPasswordResetTemplate(code, userName) {
    return `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Recuperação de Senha</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="max-width: 600px; width: 100%; background: #ffffff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: bold;">
                      🔐 Recuperação de Senha
                    </h1>
                    <p style="margin: 10px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">
                      Seu código de verificação chegou!
                    </p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                      Olá <strong>${userName || 'usuário'}</strong>,
                    </p>
                    <p style="margin: 0 0 30px; color: #374151; font-size: 16px; line-height: 1.6;">
                      Recebemos uma solicitação para redefinir a senha da sua conta. Use o código abaixo para continuar:
                    </p>
                    
                    <!-- Code Box -->
                    <table role="presentation" style="width: 100%; margin: 0 0 30px;">
                      <tr>
                        <td align="center">
                          <div style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);">
                            <p style="margin: 0; color: rgba(255,255,255,0.8); font-size: 12px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">
                              Seu Código
                            </p>
                            <p style="margin: 8px 0 0; color: #ffffff; font-size: 36px; font-weight: bold; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                              ${code}
                            </p>
                          </div>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Security Info -->
                    <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 16px 20px; border-radius: 8px; margin: 0 0 30px;">
                      <p style="margin: 0; color: #92400E; font-size: 14px; line-height: 1.5;">
                        ⚠️ <strong>Importante:</strong> Este código expira em <strong>15 minutos</strong> e só pode ser usado uma vez. Não compartilhe com ninguém!
                      </p>
                    </div>
                    
                    <p style="margin: 0 0 10px; color: #6B7280; font-size: 14px; line-height: 1.6;">
                      Se você não solicitou a recuperação de senha, ignore este email ou entre em contato com nosso suporte.
                    </p>
                    <p style="margin: 0; color: #6B7280; font-size: 14px; line-height: 1.6;">
                      Atenciosamente,<br>
                      <strong style="color: #667eea;">Equipe HackLote</strong>
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background: #F9FAFB; padding: 30px; text-align: center; border-top: 1px solid #E5E7EB;">
                    <p style="margin: 0 0 10px; color: #9CA3AF; font-size: 13px;">
                      Este é um email automático, por favor não responda.
                    </p>
                    <p style="margin: 0; color: #9CA3AF; font-size: 13px;">
                      © ${new Date().getFullYear()} HackLote. Todos os direitos reservados.
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

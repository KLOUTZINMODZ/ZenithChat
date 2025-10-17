const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

/**
 * POST /api/email/send-verification
 * Envia email de verificação com código
 */
router.post('/send-verification', async (req, res) => {
  try {
    const { email, code, subject, message, userName } = req.body;

    if (!email || !code || !subject || !userName) {
      return res.status(400).json({
        success: false,
        message: 'Parâmetros obrigatórios: email, code, subject, userName'
      });
    }

    logger.info(`Sending verification email to ${email}`);

    // Template HTML para email de verificação
    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px 20px;
            text-align: center;
          }
          .header h1 {
            color: white;
            margin: 0;
            font-size: 28px;
            font-weight: bold;
          }
          .content {
            padding: 40px 30px;
          }
          .greeting {
            font-size: 18px;
            color: #333;
            margin-bottom: 20px;
          }
          .code-box {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            border-radius: 12px;
            padding: 30px;
            margin: 30px 0;
            text-align: center;
          }
          .code {
            font-size: 36px;
            font-weight: bold;
            color: white;
            letter-spacing: 8px;
            font-family: 'Courier New', monospace;
          }
          .message {
            color: #555;
            line-height: 1.6;
            margin: 20px 0;
            font-size: 16px;
          }
          .warning {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .warning p {
            margin: 0;
            color: #856404;
            font-size: 14px;
          }
          .footer {
            background: #f8f9fa;
            padding: 20px;
            text-align: center;
            color: #6c757d;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎮 Zenith Gaming</h1>
          </div>
          <div class="content">
            <div class="greeting">
              Olá <strong>${userName}</strong>,
            </div>
            <p class="message">
              ${message || 'Você solicitou um código de verificação.'}
            </p>
            <div class="code-box">
              <div style="color: white; font-size: 14px; margin-bottom: 10px; opacity: 0.9;">
                SEU CÓDIGO DE VERIFICAÇÃO
              </div>
              <div class="code">${code}</div>
              <div style="color: white; font-size: 12px; margin-top: 10px; opacity: 0.8;">
                Válido por 15 minutos
              </div>
            </div>
            <div class="warning">
              <p>
                <strong>⚠️ Atenção:</strong> Se você não solicitou esta verificação, ignore este email e considere alterar sua senha imediatamente.
              </p>
            </div>
            <p class="message">
              Nunca compartilhe este código com ninguém. A equipe Zenith nunca solicitará este código.
            </p>
          </div>
          <div class="footer">
            <p>Este é um email automático, por favor não responda.</p>
            <p>© 2025 Zenith Gaming. Todos os direitos reservados.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Enviar email
    const result = await emailService.sendRawHtmlEmail(
      email,
      subject,
      htmlTemplate
    );

    logger.info(`Verification email sent successfully to ${email}`);

    res.json({
      success: true,
      message: 'Email de verificação enviado com sucesso',
      messageId: result.messageId
    });

  } catch (error) {
    logger.error('Error sending verification email:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao enviar email de verificação',
      error: error.message
    });
  }
});

module.exports = router;

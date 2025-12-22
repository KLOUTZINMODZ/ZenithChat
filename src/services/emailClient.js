const logger = require('../utils/logger');
const GmailProvider = require('./providers/gmailProvider');
const SesProvider = require('./providers/sesProvider');

class EmailClient {
  constructor() {
    this.providers = [];
    this.initialize();
  }

  initialize() {
    const gmailConfig = {
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASSWORD
    };

    const sesConfig = {
      accessKeyId: process.env.SES_ACCESS_KEY_ID,
      secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
      region: process.env.SES_REGION,
      fromOverride: process.env.SES_FROM_OVERRIDE
    };

    const gmailProvider = new GmailProvider(gmailConfig);
    const sesProvider = new SesProvider(sesConfig);

    // Ordem de prioridade: Gmail (primário) -> SES (fallback)
    this.providers = [gmailProvider, sesProvider].filter(p => p.enabled);

    if (this.providers.length === 0) {
      logger.error('[EmailClient] Nenhum provedor configurado. Configure Gmail ou SES.');
    } else {
      logger.info(`[EmailClient] Provedores ativos: ${this.providers.map(p => p.name).join(', ')}`);
    }
  }

  classifyError(error) {
    if (!error) return 'unknown';
    const msg = (error.message || '').toLowerCase();
    const code = error.code || error.responseCode;

    if (code === 'EAUTH' || code === 'EENVELOPE' || code === 'EINVALID') return 'auth';
    if (code === 421 || code === 422 || code === 451) return 'rate_limit';
    if (msg.includes('rate') || msg.includes('too many')) return 'rate_limit';
    if (msg.includes('invalid login') || msg.includes('authentication')) return 'auth';
    if (msg.includes('limit') && msg.includes('exceeded')) return 'rate_limit';
    return 'transient';
  }

  async send(mailOptions) {
    if (!this.providers.length) {
      throw new Error('Nenhum provedor de email configurado');
    }

    const errors = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.send(mailOptions);
        logger.info(`[EmailClient] Email enviado via ${provider.name}`);
        return { provider: provider.name, result };
      } catch (err) {
        const reason = this.classifyError(err);
        errors.push({ provider: provider.name, reason, err });
        logger.warn(`[EmailClient] Falha via ${provider.name} (${reason}):`, err);
        // Tenta próximo provedor
      }
    }

    // Se chegou aqui, todos falharam
    const summary = errors.map(e => `${e.provider}:${e.reason}`).join(', ');
    const aggregate = new Error(`Falha ao enviar email. Tentativas: ${summary}`);
    aggregate.details = errors;
    throw aggregate;
  }
}

module.exports = new EmailClient();

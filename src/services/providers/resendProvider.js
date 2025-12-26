const { Resend } = require('resend');
const logger = require('../../utils/logger');

class ResendProvider {
  constructor(config) {
    this.name = 'resend';
    this.enabled = Boolean(config?.apiKey);
    this.fromOverride = config?.fromOverride;

    if (this.enabled) {
      this.client = new Resend(config.apiKey);
      logger.info('[ResendProvider] ready');
    } else {
      logger.warn('[ResendProvider] not initialized: missing API key');
    }
  }

  formatAddress(address) {
    if (!address) return undefined;
    if (typeof address === 'string') return address;
    if (address.name) return `${address.name} <${address.address}>`;
    return address.address;
  }

  normalizeRecipients(recipients) {
    if (!recipients) return [];
    if (Array.isArray(recipients)) return recipients.filter(Boolean);
    return [recipients].filter(Boolean);
  }

  async send(mailOptions) {
    if (!this.enabled || !this.client) {
      throw new Error('Resend provider not configured');
    }

    const to = this.normalizeRecipients(mailOptions.to);
    if (!to.length) {
      throw new Error('Resend provider requires at least one recipient');
    }

    const from = this.formatAddress(this.fromOverride || mailOptions.from);
    if (!from) {
      throw new Error('Resend provider requires a from address');
    }

    const payload = {
      from,
      to,
      cc: this.normalizeRecipients(mailOptions.cc),
      bcc: this.normalizeRecipients(mailOptions.bcc),
      subject: mailOptions.subject || '',
      html: mailOptions.html || '',
      text: mailOptions.text,
      reply_to: this.normalizeRecipients(mailOptions.replyTo || mailOptions.reply_to)
        .map(addr => this.formatAddress(addr))
        .filter(Boolean)
    };

    if (!payload.reply_to.length) {
      delete payload.reply_to;
    }
    if (!payload.cc.length) delete payload.cc;
    if (!payload.bcc.length) delete payload.bcc;
    if (!payload.text) delete payload.text;

    const { data, error } = await this.client.emails.send(payload);
    if (error) {
      error.provider = 'resend';
      throw error;
    }

    return { messageId: data?.id };
  }
}

module.exports = ResendProvider;

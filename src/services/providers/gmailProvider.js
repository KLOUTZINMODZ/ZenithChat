const nodemailer = require('nodemailer');
const logger = require('../../utils/logger');

class GmailProvider {
  constructor(config) {
    this.name = 'gmail';
    this.enabled = Boolean(config?.user && config?.password);

    if (this.enabled) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: config.user,
          pass: config.password
        },
        secure: true
      });

      this.transporter.verify((error) => {
        if (error) {
          logger.error('[GmailProvider] verification failed:', error);
        } else {
          logger.info('[GmailProvider] ready');
        }
      });
    } else {
      logger.warn('[GmailProvider] not initialized: missing credentials');
    }
  }

  async send(mailOptions) {
    if (!this.enabled || !this.transporter) {
      throw new Error('Gmail provider not configured');
    }
    return this.transporter.sendMail(mailOptions);
  }
}

module.exports = GmailProvider;

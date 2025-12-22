const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const logger = require('../../utils/logger');

class SesProvider {
  constructor(config) {
    this.name = 'ses';
    this.enabled = Boolean(
      config?.accessKeyId &&
      config?.secretAccessKey &&
      config?.region
    );

    this.fromOverride = config?.fromOverride;

    if (this.enabled) {
      this.client = new SESClient({
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey
        }
      });
      logger.info('[SesProvider] ready');
    } else {
      logger.warn('[SesProvider] not initialized: missing credentials');
    }
  }

  formatFromAddress(from) {
    if (!from) return undefined;
    if (typeof from === 'string') return from;
    if (from.name) return `${from.name} <${from.address}>`;
    return from.address;
  }

  async send(mailOptions) {
    if (!this.enabled || !this.client) {
      throw new Error('SES provider not configured');
    }

    const toAddresses = Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to];
    const source = this.formatFromAddress(this.fromOverride || mailOptions.from);

    const command = new SendEmailCommand({
      Destination: { ToAddresses: toAddresses },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: mailOptions.html || ''
          }
        },
        Subject: {
          Charset: 'UTF-8',
          Data: mailOptions.subject || ''
        }
      },
      Source: source
    });

    const result = await this.client.send(command);
    return { messageId: result.MessageId || (result.$metadata && result.$metadata.requestId) };
  }
}

module.exports = SesProvider;

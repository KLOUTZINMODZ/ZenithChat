const axios = require('axios');

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};
const paymentCacheService = require('./paymentCacheService');
const MarketItem = require('../models/MarketItem');

/**
 * Serviço de Retry para Highlights
 * Processa highlights que falharam devido a problemas de conectividade
 */
class HighlightRetryService {
  constructor() {
    this.isRunning = false;
    this.retryInterval = 5 * 60 * 1000;
    

    this.startRetryProcessor();
    
    logger.info('🔄 Highlight Retry Service initialized');
  }

  /**
   * Inicia o processador de retry automático
   */
  startRetryProcessor() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.intervalId = setInterval(async () => {
      await this.processRetries();
    }, this.retryInterval);
    
    logger.info('🔄 Automatic retry processor started');
  }

  /**
   * Para o processador de retry
   */
  stopRetryProcessor() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('🛑 Retry processor stopped');
  }

  /**
   * Processa todos os highlights prontos para retry
   */
  async processRetries() {
    const readyHighlights = paymentCacheService.getHighlightsReadyForRetry();
    
    if (readyHighlights.length === 0) return;
    
    logger.info(`🔄 Processing ${readyHighlights.length} highlights ready for retry`);
    
    for (const highlight of readyHighlights) {
      await this.retryHighlight(highlight);
    }
  }

  /**
   * Tenta aplicar highlight novamente
   */
  async retryHighlight(highlight) {
    const { paymentId, highlightData } = highlight;
    
    try {
      logger.info('🔄 Retrying highlight application:', {
        paymentId,
        userId: highlightData.userId,
        retryCount: highlight.retryCount + 1
      });

      const apiSuccess = await this.tryMainAPI(highlightData);
      
      if (apiSuccess) {
        paymentCacheService.updateHighlightRetry(paymentId, true);
        await this.sendSuccessNotification(highlightData.userId, highlightData.externalReference);
        return true;
      }

      const fallbackSuccess = await this.tryLocalFallback(highlightData);
      
      if (fallbackSuccess) {
        paymentCacheService.updateHighlightRetry(paymentId, true);
        await this.sendSuccessNotification(highlightData.userId, highlightData.externalReference);
        return true;
      }

      paymentCacheService.updateHighlightRetry(paymentId, false);
      return false;

    } catch (error) {
      logger.error('❌ Error during highlight retry:', {
        paymentId,
        error: error.message
      });
      
      paymentCacheService.updateHighlightRetry(paymentId, false);
      return false;
    }
  }

  /**
   * Tenta aplicar via API principal
   */
  async tryMainAPI(highlightData) {
    try {
      const response = await axios.post(
        `${process.env.API_BASE_URL}/api/marketplace-highlights-internal`,
        {
          userId: highlightData.userId,
          externalReference: highlightData.externalReference,
          durationDays: highlightData.durationDays || 14
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.VERCEL_API_SECRET}`,
            'X-Webhook-Source': 'ZenithChatApi',
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.status === 200 && response.data.success) {
        logger.info('Main API highlight application successful');
        return true;
      }

      return false;
    } catch (error) {
      logger.warn('⚠️ Main API failed during retry:', error.message);
      return false;
    }
  }

  /**
   * Aplica highlight localmente como fallback
   */
  async tryLocalFallback(highlightData) {
    try {
      logger.info('🔧 Attempting local fallback highlight application:', {
        userId: highlightData.userId,
        externalReference: highlightData.externalReference
      });

      let items = [];
      

      const cachedItems = paymentCacheService.getMarketplaceItems(highlightData.externalReference);
      if (cachedItems && cachedItems.items) {
        items = cachedItems.items;
        logger.info('💾 Using cached marketplace items for fallback');
      } else {

        const timestamp = this.extractTimestampFromReference(highlightData.externalReference);
        const timeWindow = 30 * 60 * 1000;
        
        items = await MarketItem.find({
          sellerId: highlightData.userId,
          status: 'active',
          createdAt: {
            $gte: new Date(timestamp - timeWindow),
            $lte: new Date(timestamp + timeWindow)
          }
        }).limit(10);

        logger.info(`🔍 Found ${items.length} items in database for fallback`);
      }

      if (items.length === 0) {
        logger.warn('⚠️ No items found for local fallback highlight');
        return false;
      }

      const highlightUntil = new Date();
      highlightUntil.setDate(highlightUntil.getDate() + (highlightData.durationDays || 14));

      let highlightedCount = 0;
      for (const item of items) {
        try {
          const itemId = item._id || item.id;
          
          await MarketItem.findByIdAndUpdate(itemId, {
            $set: {
              isHighlighted: true,
              highlightUntil: highlightUntil,
              highlightedAt: new Date(),
              highlightPaymentId: highlightData.externalReference
            }
          });
          
          highlightedCount++;
        } catch (itemError) {
          logger.warn('⚠️ Failed to highlight individual item:', {
            itemId: item._id || item.id,
            error: itemError.message
          });
        }
      }

      if (highlightedCount > 0) {
        logger.info('Local fallback highlight successful:', {
          userId: highlightData.userId,
          highlightedItems: highlightedCount,
          duration: `${highlightData.durationDays || 14} days`
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('❌ Local fallback highlight failed:', {
        userId: highlightData.userId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Extrai timestamp da external_reference
   */
  extractTimestampFromReference(externalReference) {
    const match = externalReference.match(/_(\d+)$/);
    return match ? parseInt(match[1]) : Date.now();
  }

  /**
   * Envia notificação de sucesso para o usuário
   */
  async sendSuccessNotification(userId, externalReference) {
    try {

      const { sendNotificationToUser } = require('./notificationIntegrationService');
      
      await sendNotificationToUser(userId, {
        type: 'marketplace_highlight_success',
        title: '🎯 Destaque Aplicado!',
        message: 'Seus itens agora estão em destaque no marketplace por 14 dias!',
        data: {
          externalReference,
          timestamp: new Date().toISOString()
        }
      });

      logger.info('📢 Success notification sent:', { userId });
    } catch (error) {
      logger.warn('⚠️ Failed to send success notification:', error.message);
    }
  }

  /**
   * Força retry manual de um pagamento específico
   */
  async forceRetry(paymentId) {
    const pendingHighlights = paymentCacheService.getPendingHighlights();
    const highlight = pendingHighlights.find(h => h.paymentId === paymentId);
    
    if (!highlight) {
      logger.warn('⚠️ Payment not found in pending queue:', { paymentId });
      return false;
    }

    logger.info('🔧 Forcing manual retry:', { paymentId });
    return await this.retryHighlight(highlight);
  }

  /**
   * Estatísticas do serviço de retry
   */
  getStats() {
    const cacheStats = paymentCacheService.getStats();
    return {
      ...cacheStats,
      retryProcessorRunning: this.isRunning,
      retryInterval: this.retryInterval / 1000 / 60,
    };
  }
}

const highlightRetryService = new HighlightRetryService();

module.exports = highlightRetryService;


const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`)
};

/**
 * Sistema de Cache para Pagamentos e Marketplace
 * Armazena informações críticas para evitar perdas de dados
 */
class PaymentCacheService {
  constructor() {
    this.paymentCache = new Map();
    this.marketplaceItemsCache = new Map();
    this.pendingHighlights = new Map();
    this.retryQueue = new Map();
    

    setInterval(() => {
      this.cleanOldEntries();
    }, 24 * 60 * 60 * 1000);
    
    logger.info('💾 Payment Cache Service initialized');
  }

  /**
   * Armazena informações do pagamento para cache
   */
  storePaymentInfo(paymentId, paymentData) {
    const cacheEntry = {
      paymentId,
      paymentData,
      timestamp: Date.now(),
      status: paymentData.status,
      externalReference: paymentData.external_reference,
      userId: this.extractUserId(paymentData.external_reference),
      retryCount: 0
    };
    
    this.paymentCache.set(paymentId, cacheEntry);
    
    logger.info('💾 Payment cached:', {
      paymentId,
      userId: cacheEntry.userId,
      status: paymentData.status,
      externalReference: paymentData.external_reference
    });
    
    return cacheEntry;
  }

  /**
   * Armazena itens do marketplace antes do pagamento
   */
  storeMarketplaceItems(externalReference, items) {
    const cacheEntry = {
      externalReference,
      items,
      timestamp: Date.now(),
      userId: this.extractUserId(externalReference)
    };
    
    this.marketplaceItemsCache.set(externalReference, cacheEntry);
    
    logger.info('💾 Marketplace items cached:', {
      externalReference,
      itemsCount: items.length,
      items: items.map(item => ({
        id: item.id || item._id,
        title: item.title
      }))
    });
    
    return cacheEntry;
  }

  /**
   * Adiciona highlight pendente para retry
   */
  addPendingHighlight(paymentId, highlightData) {
    const retryEntry = {
      paymentId,
      highlightData,
      timestamp: Date.now(),
      retryCount: 0,
      lastRetry: null,
      maxRetries: 10,
      nextRetry: Date.now() + (5 * 60 * 1000)
    };
    
    this.pendingHighlights.set(paymentId, retryEntry);
    
    logger.info('⏳ Highlight added to pending queue:', {
      paymentId,
      userId: highlightData.userId,
      externalReference: highlightData.externalReference
    });
    
    return retryEntry;
  }

  /**
   * Busca informações de pagamento no cache
   */
  getPaymentInfo(paymentId) {
    const cached = this.paymentCache.get(paymentId);
    if (cached) {
      logger.info('💾 Payment info retrieved from cache:', { paymentId });
    }
    return cached;
  }

  /**
   * Busca itens do marketplace no cache
   */
  getMarketplaceItems(externalReference) {
    const cached = this.marketplaceItemsCache.get(externalReference);
    if (cached) {
      logger.info('💾 Marketplace items retrieved from cache:', { 
        externalReference,
        itemsCount: cached.items.length 
      });
    }
    return cached;
  }

  /**
   * Lista todos os highlights pendentes
   */
  getPendingHighlights() {
    return Array.from(this.pendingHighlights.entries()).map(([key, value]) => ({
      paymentId: key,
      ...value
    }));
  }

  /**
   * Processa highlights pendentes que estão prontos para retry
   */
  getHighlightsReadyForRetry() {
    const now = Date.now();
    const ready = [];
    
    for (const [paymentId, entry] of this.pendingHighlights.entries()) {
      if (now >= entry.nextRetry && entry.retryCount < entry.maxRetries) {
        ready.push({ paymentId, ...entry });
      }
    }
    
    return ready;
  }

  /**
   * Atualiza retry de highlight
   */
  updateHighlightRetry(paymentId, success = false) {
    const entry = this.pendingHighlights.get(paymentId);
    if (!entry) return false;

    if (success) {
      this.pendingHighlights.delete(paymentId);
      logger.info('Highlight successfully processed and removed from queue:', { paymentId });
      return true;
    }


    entry.retryCount++;
    entry.lastRetry = Date.now();
    

    const backoffMinutes = 5 * Math.pow(2, entry.retryCount - 1);
    entry.nextRetry = Date.now() + (backoffMinutes * 60 * 1000);
    
    if (entry.retryCount >= entry.maxRetries) {
      logger.error('❌ Max retries reached for highlight:', { 
        paymentId, 
        retryCount: entry.retryCount 
      });

      entry.status = 'failed';
    } else {
      logger.warn('⏳ Highlight retry scheduled:', { 
        paymentId, 
        retryCount: entry.retryCount,
        nextRetryIn: `${backoffMinutes} minutes`
      });
    }
    
    return false;
  }

  /**
   * Extrai userId da external_reference
   */
  extractUserId(externalReference) {
    if (!externalReference) return null;
    

    const match = externalReference.match(/marketplace_highlight_([^_]+)_/);
    return match ? match[1] : null;
  }

  /**
   * Limpa entradas antigas do cache
   */
  cleanOldEntries() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    
    let cleaned = 0;
    

    for (const [key, entry] of this.paymentCache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.paymentCache.delete(key);
        cleaned++;
      }
    }
    

    for (const [key, entry] of this.marketplaceItemsCache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.marketplaceItemsCache.delete(key);
        cleaned++;
      }
    }
    

    for (const [key, entry] of this.pendingHighlights.entries()) {
      if (entry.status === 'failed' && now - entry.timestamp > maxAge) {
        this.pendingHighlights.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info(`🧹 Cleaned ${cleaned} old cache entries`);
    }
  }

  /**
   * Estatísticas do cache
   */
  getStats() {
    const pending = this.getPendingHighlights();
    const readyForRetry = this.getHighlightsReadyForRetry();
    
    return {
      paymentsInCache: this.paymentCache.size,
      marketplaceItemsInCache: this.marketplaceItemsCache.size,
      pendingHighlights: pending.length,
      readyForRetry: readyForRetry.length,
      failedHighlights: pending.filter(h => h.status === 'failed').length
    };
  }

  /**
   * Busca completa por userId em todos os caches
   */
  searchByUserId(userId) {
    const results = {
      payments: [],
      marketplaceItems: [],
      pendingHighlights: []
    };
    

    for (const [key, entry] of this.paymentCache.entries()) {
      if (entry.userId === userId) {
        results.payments.push({ paymentId: key, ...entry });
      }
    }
    

    for (const [key, entry] of this.marketplaceItemsCache.entries()) {
      if (entry.userId === userId) {
        results.marketplaceItems.push({ externalReference: key, ...entry });
      }
    }
    

    for (const [key, entry] of this.pendingHighlights.entries()) {
      if (entry.highlightData?.userId === userId) {
        results.pendingHighlights.push({ paymentId: key, ...entry });
      }
    }
    
    return results;
  }
}


const paymentCacheService = new PaymentCacheService();

module.exports = paymentCacheService;

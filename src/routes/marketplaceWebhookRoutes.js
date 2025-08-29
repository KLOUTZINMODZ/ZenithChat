const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const paymentCacheService = require('../services/paymentCacheService');
const highlightRetryService = require('../services/highlightRetryService');
const MarketItem = require('../models/MarketItem');
const router = express.Router();

// Função para aplicar highlights na API principal (Vercel)
const applyHighlightToMainAPI = async (externalReference, paymentData = null) => {
  let userId = null; // Definir fora do try para acessar no catch
  
  try {
    // Extrair informações da referência externa
    // Formato esperado: marketplace_highlight_USER_ID_TIMESTAMP
    const parts = externalReference.split('_');
    if (parts.length < 4 || parts[0] !== 'marketplace' || parts[1] !== 'highlight') {
      throw new Error('Formato de referência externa inválido');
    }
    
    userId = parts[2];
    const timestamp = parts[3];
    
    // Cache payment data se fornecido
    if (paymentData) {
      paymentCacheService.storePaymentInfo(paymentData.id, paymentData);
    }
    
    logger.info('🔄 Aplicando highlight na API principal para userId:', userId);
    logger.info('📋 Dados extraídos do pagamento:', { userId, timestamp, externalReference });
    
    // Chamar API principal na Vercel para aplicar highlight
    const vercelApiUrl = process.env.VERCEL_API_URL || 'https://zenithapi-steel.vercel.app';
    
    // Tentar buscar itens do cache primeiro
    const cachedItems = paymentCacheService.getMarketplaceItems(externalReference);
    
    const response = await axios.post(`${vercelApiUrl}/api/marketplace-highlights-internal`, {
      userId: userId, // Manter como string (ObjectId)
      externalReference,
      durationDays: 14,
      cachedItems: cachedItems ? cachedItems.items : null
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Source': 'HackloteChatApi',
        'Authorization': `Bearer ${process.env.VERCEL_API_SECRET}`
      },
      timeout: 30000
    });
    
    if (response.data.success) {
      logger.info('✅ Highlight aplicado com sucesso na API principal:', response.data);
      return {
        success: true,
        message: 'Highlight aplicado com sucesso',
        data: response.data.data
      };
    } else {
      logger.error('❌ Erro na resposta da API principal:', response.data);
      return {
        success: false,
        message: response.data.message || 'Erro na API principal',
        error: 'MAIN_API_ERROR'
      };
    }
  } catch (error) {
    logger.error('❌ Erro ao comunicar com API principal:', error.message);
    
    // Adicionar ao retry queue se for erro de conectividade
    if (paymentData && error.code === 'ECONNREFUSED' || error.response?.status >= 500) {
      const highlightData = {
        userId,
        externalReference,
        durationDays: 14
      };
      
      paymentCacheService.addPendingHighlight(paymentData.id, highlightData);
      logger.info('⏳ Highlight adicionado à fila de retry devido a erro de conectividade');
    }
    
    return {
      success: false,
      message: 'Erro ao conectar com API principal',
      error: 'MAIN_API_CONNECTION_ERROR'
    };
  }
};

// Função para processar notificação do Mercado Pago
const processMercadoPagoNotification = async (notification) => {
  try {
    logger.info('💳 Processando notificação do Mercado Pago:', notification);
    
    // Verificar tipo de notificação
    if (notification.type !== 'payment') {
      logger.info('⚠️ Tipo de notificação ignorado:', notification.type);
      return { success: true, message: 'Tipo de notificação ignorado' };
    }
    
    const paymentId = notification.data?.id;
    if (!paymentId) {
      logger.warn('⚠️ ID do pagamento não encontrado na notificação');
      return { success: false, message: 'ID do pagamento não encontrado' };
    }
    
    logger.info('🔍 Consultando detalhes do pagamento no Mercado Pago:', paymentId);
    
    // Fazer chamada real para a API do Mercado Pago
    let paymentDetails;
    try {
      const mpResponse = await axios.get(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`
          },
          timeout: 10000
        }
      );
      
      paymentDetails = mpResponse.data;
      logger.info('💰 Detalhes do pagamento obtidos da API do Mercado Pago:', {
        id: paymentDetails.id,
        status: paymentDetails.status,
        external_reference: paymentDetails.external_reference,
        transaction_amount: paymentDetails.transaction_amount
      });
    } catch (error) {
      logger.error('❌ Erro ao consultar API do Mercado Pago:', error.message);
      
      // Retornar erro se não conseguir acessar API do Mercado Pago
      return {
        success: false,
        message: 'Erro ao consultar detalhes do pagamento no Mercado Pago',
        error: 'MERCADOPAGO_API_ERROR'
      };
    }
    
    logger.info('💰 Detalhes do pagamento obtidos:', paymentDetails);
    
    // Processar apenas pagamentos aprovados
    if (paymentDetails.status === 'approved') {
      const result = await applyHighlightToMainAPI(paymentDetails.external_reference, paymentDetails);
      
      if (result.success) {
        logger.info('✅ Highlight aplicado com sucesso após confirmação de pagamento');
        
        // Enviar notificação ao usuário sobre confirmação do pagamento
        try {
          // Extrair userId real da external_reference
          // Formato esperado: "marketplace_highlight_USERID_TIMESTAMP"
          const refParts = paymentDetails.external_reference.split('_');
          const userId = refParts.length >= 4 ? refParts[2] : null;
          
          if (userId) {
            // Usar comunicação direta em vez de HTTP request
            const NotificationIntegrationService = require('../services/notificationIntegrationService');
            const notificationService = new NotificationIntegrationService();
            
            await notificationService.sendNotification(userId, {
              type: 'marketplace_highlight_confirmed',
              title: '🎉 Destaque Ativado!',
              message: `Seus itens do marketplace foram destacados com sucesso. O destaque ficará ativo por 14 dias.`,
              data: {
                highlightedItems: result.data?.highlightedItems || [],
                totalItems: result.data?.totalItems || 0,
                expiresAt: result.data?.highlightExpires
              }
            });
            
            logger.info('✅ Notificação de confirmação enviada ao usuário via WebSocket direto');
          } else {
            logger.warn('⚠️ UserId inválido extraído da referência externa');
          }
        } catch (error) {
          logger.warn('⚠️ Erro ao enviar notificação ao usuário:', error.message);
        }
        
        return {
          success: true,
          message: 'Pagamento confirmado e highlight aplicado',
          data: result.data
        };
      } else {
        logger.error('❌ Erro ao aplicar highlight após pagamento:', result.message);
        return {
          success: false,
          message: result.message,
          error: result.error
        };
      }
    } else {
      logger.info(`⚠️ Pagamento com status ${paymentDetails.status}, não processando highlight`);
      return {
        success: true,
        message: `Pagamento com status ${paymentDetails.status}`
      };
    }
  } catch (error) {
    logger.error('❌ Erro ao processar notificação do Mercado Pago:', error);
    return {
      success: false,
      message: error.message,
      error: 'NOTIFICATION_PROCESSING_ERROR'
    };
  }
};

// Webhook para receber notificações do Mercado Pago
router.post('/mercadopago-webhook', async (req, res) => {
  logger.info('🔔 Webhook Mercado Pago recebido na HackloteChatApi');
  
  try {
    // Extrair dados do webhook do Mercado Pago
    let notification = {};
    
    // Verificar se há dados na query string (formato comum do Mercado Pago)
    if (req.query.type && req.query['data.id']) {
      notification = {
        type: req.query.type,
        data: { id: req.query['data.id'] }
      };
      logger.info('📥 Notificação extraída da query string:', notification);
    } 
    // Verificar se há dados no body
    else if (req.body && typeof req.body === 'object') {
      notification = req.body;
      logger.info('📥 Notificação extraída do body:', notification);
    }
    // Verificar parâmetros da URL (formato alternativo)
    else if (req.query.id && req.query.topic) {
      notification = {
        type: req.query.topic === 'payment' ? 'payment' : req.query.topic,
        data: { id: req.query.id }
      };
      logger.info('📥 Notificação extraída dos parâmetros URL:', notification);
    }
    
    // Validar se conseguimos extrair uma notificação válida
    if (!notification.type || !notification.data?.id) {
      logger.warn('⚠️ Estrutura de notificação inválida ou incompleta');
      logger.debug('Query:', req.query);
      logger.debug('Body:', req.body);
      
      // Responder com sucesso para evitar reenvios do Mercado Pago
      return res.status(200).json({
        success: true,
        message: 'Webhook recebido mas estrutura inválida'
      });
    }
    
    // Processar apenas notificações de pagamento
    if (notification.type !== 'payment') {
      logger.info(`⚠️ Tipo de notificação '${notification.type}' ignorado`);
      return res.status(200).json({
        success: true,
        message: 'Tipo de notificação ignorado'
      });
    }
    
    // Processar notificação
    const result = await processMercadoPagoNotification(notification);
    
    res.status(200).json({
      success: true,
      message: result.message || 'Webhook processado',
      data: result.data || null
    });
    
  } catch (error) {
    logger.error('❌ Erro no webhook marketplace Mercado Pago:', error);
    
    // Sempre responder com 200 para evitar reenvios desnecessários
    res.status(200).json({
      success: false,
      message: 'Erro processado, webhook recebido'
    });
  }
});

// Endpoint de teste para simular webhook do Mercado Pago
router.post('/test-webhook', async (req, res) => {
  logger.info('🧪 Teste de webhook recebido');
  
  try {
    const { userId, paymentId, status = 'approved' } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId é obrigatório para o teste'
      });
    }
    
    // Simular notificação do Mercado Pago
    const testNotification = {
      type: 'payment',
      data: {
        id: paymentId || `test_payment_${Date.now()}`
      }
    };
    
    logger.info('🔄 Processando notificação de teste:', testNotification);
    
    const result = await processMercadoPagoNotification(testNotification);
    
    res.json({
      success: true,
      message: 'Teste de webhook processado',
      testNotification,
      result
    });
  } catch (error) {
    logger.error('❌ Erro no teste de webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Erro no teste de webhook',
      error: error.message
    });
  }
});

// Health check específico para webhooks
router.get('/health', (req, res) => {
  res.json({
    service: 'Marketplace Webhook Service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      webhook: 'POST /marketplace-webhook/mercadopago-webhook',
      test: 'POST /marketplace-webhook/test-webhook'
    },
    configuration: {
      vercelApiUrl: process.env.VERCEL_API_URL || 'not configured',
      hasVercelSecret: !!process.env.VERCEL_API_SECRET
    }
  });
});

module.exports = router;

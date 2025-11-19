const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const MessageHandler = require('./handlers/MessageHandler');
const NotificationHandler = require('./handlers/NotificationHandler');
const WhatsAppMessageHandler = require('./handlers/WhatsAppMessageHandler');
const ConversationHandler = require('./handlers/ConversationHandler');
const ProposalHandler = require('./handlers/ProposalHandler');
const PresenceHandler = require('./handlers/PresenceHandler');
const ConnectionManager = require('./ConnectionManager');
const NotificationIntegrationService = require('../services/NotificationIntegrationService');
const { authenticateWebSocket } = require('../middleware/wsAuth');
const { sanitizeWebSocketPayload } = require('../utils/dataSanitizer');

class WebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ 
      server,
      verifyClient: this.verifyClient.bind(this)
    });
    
    this.connectionManager = new ConnectionManager();
    this.conversationHandler = new ConversationHandler(this.connectionManager);
    this.proposalHandler = new ProposalHandler(this.connectionManager);
    this.messageHandler = new MessageHandler(this.connectionManager, this.conversationHandler);
    this.whatsAppHandler = new WhatsAppMessageHandler(this.connectionManager);

    this.notificationService = new NotificationIntegrationService(this.connectionManager);
    this.notificationHandler = new NotificationHandler(this.connectionManager, this.notificationService);
    this.presenceHandler = new PresenceHandler(this.connectionManager);
    
    this.setupWebSocketServer();
    this.startHeartbeat();
  }

  async verifyClient(info, cb) {
    try {

      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token') || 
                    info.req.headers.authorization?.replace('Bearer ', '');



      if (!token) {
        cb(false, 401, 'Unauthorized: No token provided');
        return;
      }


      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const possibleId = decoded.id || decoded._id || decoded.userid || decoded.userId || decoded.user?.id || decoded.user?._id;
      const userId = (possibleId && possibleId.toString) ? possibleId.toString() : String(possibleId || '');
      
      // VERIFICAR BANIMENTO ANTES DE ACEITAR CONEXÃO
      const authResult = await authenticateWebSocket(token);
      
      if (!authResult.success) {
        if (authResult.banned) {
          logger.warn(`🚫 Usuário banido tentou conectar via WebSocket: ${userId}`);
          cb(false, 403, 'Account banned');
        } else {
          cb(false, 401, authResult.error || 'Authentication failed');
        }
        return;
      }
      
      info.req.userId = userId;
      info.req.userToken = token;
      
      cb(true);
    } catch (error) {
      logger.error('WebSocket authentication failed:', {
        error: error.message,
        stack: error.stack
      });
      cb(false, 401, 'Invalid token');
    }
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const userId = req.userId;
      const userToken = req.userToken;

  

      this.connectionManager.addConnection(userId, ws);

      ws.isAlive = true;
      ws.userId = userId;
      ws.userToken = userToken;

      ws.on('pong', () => {
        ws.isAlive = true;
        try { this.presenceHandler.onActivity(userId); } catch (_) {}
      });


      this.conversationHandler.registerEvents(ws);
      this.presenceHandler.registerEvents(ws);
      

      this.proposalHandler.registerEvents(ws);


      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          try { this.presenceHandler.onActivity(ws.userId); } catch (_) {}
          await this.handleMessage(ws, message);
        } catch (error) {
          logger.error('Error processing message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });


      ws.on('close', (code, reason) => {
        this.connectionManager.removeConnection(userId, ws);
        

        try {
          this.notificationHandler.handleUserDisconnected(userId);
          this.conversationHandler.onUserDisconnect(userId);
          this.presenceHandler.onUserDisconnected(userId);
          this.proposalHandler.onUserDisconnect(userId); // ✅ Cleanup de inscrições
        } catch (error) {
          logger.error('Error handling user disconnection:', error);
        }
      });


      ws.on('error', (error) => {
        logger.error(`WebSocket error for user ${userId}:`, {
          error: error.message,
          code: error.code,
          stack: error.stack
        });
        

        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, 'Server error');
          }
        } catch (closeError) {
          logger.error('Error closing WebSocket after error:', closeError);
        }
      });


      // Enviar confirmação de conexão (sem expor userId - já está no token JWT)
      this.sendMessage(ws, {
        type: 'connection',
        status: 'connected',
        timestamp: new Date().toISOString()
        // userId removido: cliente já tem essa informação no JWT token
      });


      this.messageHandler.sendPendingMessages(userId, ws);
      

      this.notificationHandler.handleUserConnected(userId);
      try { this.presenceHandler.onUserConnected(userId); } catch (_) {}
    });

    this.wss.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });
  }

  async handleMessage(ws, message) {
    const { type, ...payload } = message;


    switch (type) {
      case 'message:send':
        try { this.presenceHandler.onActivity(ws.userId); } catch (_) {}
        await this.messageHandler.handleSendMessage(ws.userId, payload);
        break;

      case 'message:typing':
        try { this.presenceHandler.onActivity(ws.userId); } catch (_) {}
        await this.messageHandler.handleTypingIndicator(ws.userId, payload);
        break;

      case 'message:read':
        await this.messageHandler.handleMarkAsRead(ws.userId, payload);
        break;

      case 'conversation:open':
        await this.messageHandler.handleOpenConversation(ws.userId, payload);
        break;

      case 'conversation:close':
        await this.messageHandler.handleCloseConversation(ws.userId, payload);
        break;

      case 'conversation:list':
        await this.messageHandler.handleListConversations(ws.userId, ws);
        break;

      case 'message:history':
        await this.messageHandler.handleGetMessageHistory(ws.userId, payload, ws);
        break;


      case 'conversations:start_polling':
        await this.conversationHandler.handleStartPolling(ws, payload);
        break;

      case 'conversations:stop_polling':
        await this.conversationHandler.handleStopPolling(ws);
        break;

      case 'conversations:get_list':
        await this.conversationHandler.handleGetConversations(ws, payload);
        break;

      // Presence channel
      case 'presence:subscribe':
        this.presenceHandler.handleSubscribe(ws, payload);
        break;
      case 'presence:unsubscribe':
        this.presenceHandler.handleUnsubscribe(ws, payload);
        break;
      case 'presence:query':
        this.presenceHandler.handleQuery(ws, payload);
        break;


      case 'proposal:accepted':
        await this.proposalHandler.handleProposalAccepted(ws, payload);
        break;

      case 'proposal:update_status':
        await this.proposalHandler.handleProposalStatusUpdate(ws, payload);
        break;

      case 'message:delivery_ack':
        await this.messageHandler.handleDeliveryAck(payload.messageId, ws.userId);
        break;

      case 'message:read_ack':
        await this.messageHandler.handleReadAck(payload.messageId, ws.userId);
        break;


      case 'message:send_with_delivery':
        await this.handleSendMessageWithDelivery(ws.userId, payload);
        break;


      case 'notification:subscribe':
        await this.notificationHandler.handleSubscribe(ws.userId, payload);
        break;

      case 'notification:unsubscribe':
        await this.notificationHandler.handleUnsubscribe(ws.userId, payload);
        break;

      case 'notification:acknowledge':
        await this.notificationHandler.handleAcknowledge(ws.userId, payload);
        break;

      case 'notification:get_history':
        await this.notificationHandler.handleGetHistory(ws.userId, payload);
        break;

      case 'notification:mark_read':
        await this.notificationHandler.handleMarkAsRead(ws.userId, payload);
        break;

      case 'notification:get_unread_count':
        await this.notificationHandler.handleGetUnreadCount(ws.userId);
        break;

      case 'notification:test':
        await this.notificationHandler.handleTestNotification(ws.userId, payload);
        break;

      case 'ping':
        this.sendMessage(ws, { type: 'pong', timestamp: new Date().toISOString() });
        break;

      default:
        logger.warn(`Unknown message type: ${type}`);
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }

  /**
   * Handle enhanced message sending with WhatsApp-like delivery tracking
   */
  async handleSendMessageWithDelivery(userId, payload) {
    try {
      const { conversationId, content, type, messageType, attachments = [] } = payload;
      const finalType = type || messageType || 'text';


      const Conversation = require('../models/Conversation');
      const conversation = await Conversation.findById(conversationId)
        .populate('participants', '_id');

      if (!conversation) {
        throw new Error('Conversation not found');
      }

      const recipients = conversation.participants
        .map(p => p._id.toString())
        .filter(id => id !== userId);


      const Message = require('../models/Message');
      const { encryptMessage } = require('../utils/encryption');
      
      const message = new Message({
        conversation: conversationId,
        sender: userId,
        content: encryptMessage(content),
        type: finalType,
        attachments,
        readBy: [{ user: userId, readAt: new Date() }]
      });

      await message.save();
      await message.populate('sender', 'name avatar');


      const messageId = await this.messageHandler.sendMessageWithDelivery(
        userId,
        {
          ...message.toObject(),
          content: content
        },
        recipients
      );

      logger.info(`Enhanced message sent with delivery tracking: ${messageId}`);

    } catch (error) {
      logger.error('Error handling enhanced send message:', error);
      this.sendError(userId, error.message);
    }
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      // Aplicar sanitização mesmo em mensagens diretas (defesa em profundidade)
      const sanitized = sanitizeWebSocketPayload(message, ws.userId);
      ws.send(JSON.stringify(sanitized));
    }
  }

  sendError(ws, error) {
    this.sendMessage(ws, {
      type: 'error',
      error: error,
      timestamp: new Date().toISOString()
    });
  }

  startHeartbeat() {
    const interval = parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 60000;
        this.heartbeatInterval = setInterval(() => {
      
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          logger.warn(`Terminating inactive connection for user: ${ws.userId}`);
          this.connectionManager.removeConnection(ws.userId, ws);
        }

        ws.isAlive = false;
        

        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch (error) {
            logger.error(`Error sending ping to user ${ws.userId}:`, error);
            ws.terminate();
          }
        }
      });
    }, interval);
  }

  broadcast(message, excludeUserId = null) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client.userId !== excludeUserId) {
        client.send(JSON.stringify(message));
      }
    });
  }

  sendToUser(userId, message) {
    const connections = this.connectionManager.getUserConnections(userId);
    
    if (connections.length === 0) {
      return;
    }
    
    let sentCount = 0;
    connections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message));
          sentCount++;
        } catch (error) {
          logger.error(`Error sending message to user ${userId}:`, error);
        }
      }
    });
  }

  /**
   * DESCONECTAR USUÁRIO BANIDO
   * Usado quando um usuário é banido enquanto está conectado
   */
  disconnectUser(userId, reason = 'Account banned') {
    const connections = this.connectionManager.getUserConnections(userId);
    
    if (connections.length === 0) {
      logger.info(`No active connections for user ${userId}`);
      return;
    }
    
    logger.warn(`🚫 Desconectando usuário banido: ${userId}`);
    
    connections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Enviar mensagem de erro antes de desconectar
          ws.send(JSON.stringify({
            type: 'error',
            error: reason,
            banned: true,
            forceLogout: true,
            timestamp: new Date().toISOString()
          }));
          
          // Fechar conexão com código 1008 (Policy Violation)
          ws.close(1008, reason);
        } catch (error) {
          logger.error(`Error disconnecting user ${userId}:`, error);
          ws.terminate();
        }
      }
    });
    
    // Remover todas as conexões do gerenciador
    this.connectionManager.removeUser(userId);
  }

  close() {
    clearInterval(this.heartbeatInterval);
    this.wss.close();
    logger.info('WebSocket server closed');
  }
}

module.exports = WebSocketServer;

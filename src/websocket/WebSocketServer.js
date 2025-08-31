const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const MessageHandler = require('./handlers/MessageHandler');
const NotificationHandler = require('./handlers/NotificationHandler');
const WhatsAppMessageHandler = require('./handlers/WhatsAppMessageHandler');
const ConnectionManager = require('./ConnectionManager');
const NotificationIntegrationService = require('../services/NotificationIntegrationService');
const { authenticateWebSocket } = require('../middleware/wsAuth');

class WebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ 
      server,
      verifyClient: this.verifyClient.bind(this)
    });
    
    this.connectionManager = new ConnectionManager();
    this.messageHandler = new MessageHandler(this.connectionManager);
    this.whatsAppHandler = new WhatsAppMessageHandler(this.connectionManager);
    

    this.notificationService = new NotificationIntegrationService(this.connectionManager);
    this.notificationHandler = new NotificationHandler(this.connectionManager, this.notificationService);
    
    this.setupWebSocketServer();
    this.startHeartbeat();
  }

  verifyClient(info, cb) {
    try {

      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token') || 
                    info.req.headers.authorization?.replace('Bearer ', '');

      logger.info('🔌 WebSocket connection attempt', {
        url: info.req.url,
        origin: info.origin,
        hasToken: !!token,
        host: info.req.headers.host,
        userAgent: info.req.headers['user-agent'],
        timestamp: new Date().toISOString()
      });

      if (!token) {
        logger.warn('WebSocket connection rejected: No token provided');
        cb(false, 401, 'Unauthorized: No token provided');
        return;
      }


      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      info.req.userId = decoded.id || decoded._id;
      info.req.userToken = token;
      
      logger.info('WebSocket authentication successful', {
        userId: info.req.userId,
        tokenValid: true
      });
      
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

      logger.info(`New WebSocket connection from user: ${userId}`);


      this.connectionManager.addConnection(userId, ws);


      ws.isAlive = true;
      ws.userId = userId;
      ws.userToken = userToken;

      ws.on('pong', () => {
        ws.isAlive = true;
      });


      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(ws, message);
        } catch (error) {
          logger.error('Error processing message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });


      ws.on('close', (code, reason) => {
        logger.info(`WebSocket connection closed for user: ${userId}`, {
          code,
          reason: reason?.toString(),
          wasClean: code === 1000
        });
        this.connectionManager.removeConnection(userId, ws);
        

        try {
          this.notificationHandler.handleUserDisconnected(userId);
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


      this.sendMessage(ws, {
        type: 'connection',
        status: 'connected',
        userId: userId,
        timestamp: new Date().toISOString()
      });


      this.messageHandler.sendPendingMessages(userId, ws);
      

      this.notificationHandler.handleUserConnected(userId);
    });

    this.wss.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });
  }

  async handleMessage(ws, message) {
    const { type, ...payload } = message;

    logger.debug(`Handling message type: ${type} from user: ${ws.userId}`);

    switch (type) {
      case 'message:send':
        await this.messageHandler.handleSendMessage(ws.userId, payload);
        break;

      case 'message:typing':
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
      const { conversationId, content, type = 'text', attachments = [] } = payload;


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
        type,
        attachments,
        readBy: [{ user: userId, readAt: new Date() }]
      });

      await message.save();
      await message.populate('sender', 'name email avatar');


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
      ws.send(JSON.stringify(message));
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
    
    logger.info(`Starting WebSocket heartbeat with interval: ${interval}ms`);
    
    this.heartbeatInterval = setInterval(() => {
      logger.debug(`Heartbeat check - Active connections: ${this.wss.clients.size}`);
      
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          logger.warn(`Terminating inactive connection for user: ${ws.userId}`);
          this.connectionManager.removeConnection(ws.userId, ws);
          return ws.terminate();
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
    connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  close() {
    clearInterval(this.heartbeatInterval);
    this.wss.close();
    logger.info('WebSocket server closed');
  }
}

module.exports = WebSocketServer;

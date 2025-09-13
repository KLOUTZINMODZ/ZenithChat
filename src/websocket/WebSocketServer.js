const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const MessageHandler = require('./handlers/MessageHandler');
const NotificationHandler = require('./handlers/NotificationHandler');
const WhatsAppMessageHandler = require('./handlers/WhatsAppMessageHandler');
const ConversationHandler = require('./handlers/ConversationHandler');
const ProposalHandler = require('./handlers/ProposalHandler');
const ConnectionManager = require('./ConnectionManager');
const NotificationIntegrationService = require('../services/NotificationIntegrationService');
const { authenticateWebSocket } = require('../middleware/wsAuth');

const WS_VERBOSE = (process.env.WS_VERBOSE_LOGS === '1' || process.env.WS_VERBOSE_LOGS === 'true' || process.env.CHAT_DEBUG === '1');
function vinfo(label, data = {}) {
  try {
    if (WS_VERBOSE) {
      logger.info(`[WS-VERBOSE] ${label} ${JSON.stringify(data)}`);
    }
  } catch (_) {}
}

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
    
    this.setupWebSocketServer();
    this.startHeartbeat();
    vinfo('WSS:INIT', { heartbeat: true });
  }

  verifyClient(info, cb) {
    try {

      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token') || 
                    info.req.headers.authorization?.replace('Bearer ', '');



      if (!token) {
        cb(false, 401, 'Unauthorized: No token provided');
        return;
      }


      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      info.req.userId = decoded.id || decoded._id;
      info.req.userToken = token;
      vinfo('WSS:VERIFY_CLIENT_OK', { userId: info.req.userId, hasToken: !!token });
      
      
      cb(true);
    } catch (error) {
      logger.error('WebSocket authentication failed:', {
        error: error.message,
        stack: error.stack
      });
      vinfo('WSS:VERIFY_CLIENT_FAIL', { error: error?.message });
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
      vinfo('WSS:CONNECTION_OPEN', { userId, connections: this.connectionManager.getUserConnectionCount(userId) });

      ws.on('pong', () => {
        ws.isAlive = true;
        vinfo('WSS:PONG', { userId });
      });


      this.conversationHandler.registerEvents(ws);
      

      this.proposalHandler.registerEvents(ws);


      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          vinfo('WSS:RECEIVED', { userId, type: message?.type, hasMessageId: !!message?.messageId });
          await this.handleMessage(ws, message);
          vinfo('WSS:HANDLED', { userId, type: message?.type });
        } catch (error) {
          logger.error('Error processing message:', error);
          this.sendError(ws, 'Invalid message format');
          vinfo('WSS:RECEIVED_ERROR', { userId, error: error?.message });
        }
      });


      ws.on('close', (code, reason) => {
        this.connectionManager.removeConnection(userId, ws);
        

        try {
          this.notificationHandler.handleUserDisconnected(userId);
          this.conversationHandler.onUserDisconnect(userId);
        } catch (error) {
          logger.error('Error handling user disconnection:', error);
        }
        vinfo('WSS:CLOSE', { userId, code, reason: reason?.toString?.() || String(reason || '') });
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
        vinfo('WSS:ERROR', { userId, error: error?.message });
      });


      this.sendMessage(ws, {
        type: 'connection',
        status: 'connected',
        userId: userId,
        timestamp: new Date().toISOString()
      });
      vinfo('WSS:SEND_CONNECTION', { userId });


      vinfo('WSS:PENDING_BEGIN', { userId });
      const started = Date.now();
      this.messageHandler.sendPendingMessages(userId, ws).then(() => {
        vinfo('WSS:PENDING_DONE', { userId, ms: Date.now() - started });
      }).catch(err => {
        vinfo('WSS:PENDING_ERR', { userId, error: err?.message });
      });
      

      this.notificationHandler.handleUserConnected(userId);
    });

    this.wss.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });
  }

  async handleMessage(ws, message) {
    const { type, ...payload } = message;


    switch (type) {
      case 'message:send':
        vinfo('WSS:ROUTE:message:send', { userId: ws.userId, hasData: !!payload?.data });
        await this.messageHandler.handleSendMessage(ws.userId, payload);
        break;

      case 'message:typing':
        vinfo('WSS:ROUTE:message:typing', { userId: ws.userId, conversationId: payload?.conversationId, isTyping: payload?.isTyping });
        await this.messageHandler.handleTypingIndicator(ws.userId, payload);
        break;

      case 'message:read':
        vinfo('WSS:ROUTE:message:read', { userId: ws.userId, conversationId: payload?.conversationId, count: (payload?.messageIds || []).length });
        await this.messageHandler.handleMarkAsRead(ws.userId, payload);
        break;

      case 'conversation:open':
        vinfo('WSS:ROUTE:conversation:open', { userId: ws.userId, conversationId: payload?.conversationId });
        await this.messageHandler.handleOpenConversation(ws.userId, payload);
        break;

      case 'conversation:close':
        vinfo('WSS:ROUTE:conversation:close', { userId: ws.userId, conversationId: payload?.conversationId });
        await this.messageHandler.handleCloseConversation(ws.userId, payload);
        break;

      case 'conversation:list':
        vinfo('WSS:ROUTE:conversation:list', { userId: ws.userId });
        await this.messageHandler.handleListConversations(ws.userId, ws);
        break;

      case 'message:history':
        vinfo('WSS:ROUTE:message:history', { userId: ws.userId, conversationId: payload?.conversationId, limit: payload?.limit, before: payload?.before });
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


      case 'proposal:accepted':
        await this.proposalHandler.handleProposalAccepted(ws, payload);
        break;

      case 'proposal:update_status':
        await this.proposalHandler.handleProposalStatusUpdate(ws, payload);
        break;

      case 'message:delivery_ack':
        vinfo('WSS:ROUTE:message:delivery_ack', { userId: ws.userId, messageId: payload.messageId });
        await this.messageHandler.handleDeliveryAck(payload.messageId, ws.userId);
        break;

      case 'message:read_ack':
        vinfo('WSS:ROUTE:message:read_ack', { userId: ws.userId, messageId: payload.messageId });
        await this.messageHandler.handleReadAck(payload.messageId, ws.userId);
        break;


      case 'message:send_with_delivery':
        vinfo('WSS:ROUTE:message:send_with_delivery', { userId: ws.userId, conversationId: payload?.conversationId });
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
        vinfo('WSS:ROUTE:ping', { userId: ws.userId });
        break;

      default:
        logger.warn(`Unknown message type: ${type}`);
        this.sendError(ws, `Unknown message type: ${type}`);
        vinfo('WSS:ROUTE:unknown', { userId: ws.userId, type });
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
      vinfo('WSS:SEND', { userId: ws.userId, type: message?.type, conversationId: message?.data?.conversationId, messageId: message?.data?.messageId });
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
            vinfo('WSS:HEARTBEAT:PING', { userId: ws.userId });
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

  close() {
    clearInterval(this.heartbeatInterval);
    this.wss.close();
    logger.info('WebSocket server closed');
  }
}

module.exports = WebSocketServer;

/**
 * ProposalHandler - Gerencia eventos de propostas via WebSocket
 * Implementa padrão Eldorado: uma conversa por proposta
 */

const logger = require('../../utils/logger');
const Conversation = require('../../models/Conversation');

class ProposalHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    // Map: boostingId -> Set de userIds inscritos
    this.boostingSubscriptions = new Map();
  }

  /**
   * Registra eventos de proposta para uma conexão WebSocket
   */
  registerEvents(ws) {
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'proposal:update_status':
            await this.handleProposalStatusUpdate(ws, message);
            break;
          case 'proposal:accepted':
            await this.handleProposalAccepted(ws, message);
            break;
        }
      } catch (error) {
        logger.error('Error in ProposalHandler:', error);
      }
    });
  }

  /**
   * Lida com evento de proposta aceita
   */
  async handleProposalAccepted(ws, payload) {
    try {
      const { proposalId, conversationId, boostingId } = payload;
      
      logger.info(`🔄 Proposta aceita: ${proposalId}`);


      const conversation = await Conversation.findOne({
        proposalId: proposalId
      });

      if (!conversation) {
        logger.error(`Conversa não encontrada para proposalId: ${proposalId}`);
        return;
      }


      conversation.isTemporary = false;
      conversation.status = 'accepted';
      conversation.boostingStatus = 'active';
      conversation.expiresAt = null;
      
      await conversation.save();


      const participants = conversation.participants;
      
      participants.forEach(participantId => {
        const connections = this.connectionManager.getUserConnections(participantId.toString());
        
        connections.forEach(connection => {
          if (connection.readyState === 1) {
            connection.send(JSON.stringify({
              type: 'proposal:accepted',
              data: {
                proposalId,
                conversationId: conversation._id,
                boostingId,
                isTemporary: false,
                status: 'accepted',
                boostingStatus: 'active',
                message: 'Proposta aceita! Chat convertido para permanente.'
              }
            }));
          }
        });
      });


      participants.forEach(participantId => {
        const connections = this.connectionManager.getUserConnections(participantId.toString());
        
        connections.forEach(connection => {
          if (connection.readyState === 1) {
            connection.send(JSON.stringify({
              type: 'conversations:update',
              data: {
                conversationId: conversation._id,
                action: 'status_updated'
              }
            }));
          }
        });
      });

      logger.info(`Proposta ${proposalId} processada com sucesso`);

    } catch (error) {
      logger.error('Erro ao processar proposta aceita:', error);
      
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Erro ao processar proposta aceita'
        }));
      }
    }
  }

  /**
   * Atualiza status de proposta
   */
  async handleProposalStatusUpdate(ws, payload) {
    try {
      const { proposalId, status, conversationId } = payload;
      

      const conversation = await Conversation.findById(conversationId);
      
      if (conversation) {
        conversation.boostingStatus = status;
        await conversation.save();


        const participants = conversation.participants;
        
        participants.forEach(participantId => {
          const connections = this.connectionManager.getUserConnections(participantId.toString());
          
          connections.forEach(connection => {
            if (connection.readyState === 1) {
              connection.send(JSON.stringify({
                type: 'proposal:status_updated',
                data: {
                  proposalId,
                  conversationId,
                  status,
                  timestamp: new Date().toISOString()
                }
              }));
            }
          });
        });
      }

    } catch (error) {
      logger.error('Erro ao atualizar status da proposta:', error);
    }
  }

  /**
   * Subscribe para receber atualizações de propostas de um boosting específico
   */
  async handleSubscribeToBoosting(ws, payload) {
    try {
      const { boostingId } = payload;
      const userId = ws.userId;

      if (!boostingId) {
        logger.warn('boostingId não fornecido no subscribe');
        return;
      }

      // Criar set se não existir
      if (!this.boostingSubscriptions.has(boostingId)) {
        this.boostingSubscriptions.set(boostingId, new Set());
      }

      // Adicionar usuário ao set
      this.boostingSubscriptions.get(boostingId).add(userId);

      logger.info(`✅ User ${userId} subscribed to boosting ${boostingId} proposals`);

      // Confirmar inscrição
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'proposal:subscribed',
          data: {
            boostingId,
            message: 'Inscrito para receber atualizações de propostas'
          }
        }));
      }
    } catch (error) {
      logger.error('Erro ao fazer subscribe em boosting:', error);
    }
  }

  /**
   * Unsubscribe de atualizações de propostas
   */
  async handleUnsubscribeFromBoosting(ws, payload) {
    try {
      const { boostingId } = payload;
      const userId = ws.userId;

      if (!boostingId) {
        return;
      }

      if (this.boostingSubscriptions.has(boostingId)) {
        this.boostingSubscriptions.get(boostingId).delete(userId);
        
        // Limpar set vazio
        if (this.boostingSubscriptions.get(boostingId).size === 0) {
          this.boostingSubscriptions.delete(boostingId);
        }
      }

      logger.info(`❌ User ${userId} unsubscribed from boosting ${boostingId} proposals`);

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'proposal:unsubscribed',
          data: {
            boostingId
          }
        }));
      }
    } catch (error) {
      logger.error('Erro ao fazer unsubscribe de boosting:', error);
    }
  }

  /**
   * Notifica todos os usuários inscritos sobre uma nova proposta
   */
  notifyNewProposal(boostingId, proposalData) {
    try {
      if (!this.boostingSubscriptions.has(boostingId)) {
        logger.info(`Nenhum usuário inscrito no boosting ${boostingId}`);
        return;
      }

      const subscribers = this.boostingSubscriptions.get(boostingId);
      let notifiedCount = 0;

      subscribers.forEach(userId => {
        const connections = this.connectionManager.getUserConnections(userId);
        
        connections.forEach(ws => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'proposal:new',
              data: {
                boostingId,
                proposal: proposalData,
                timestamp: new Date().toISOString()
              }
            }));
            notifiedCount++;
          }
        });
      });

      logger.info(`📢 Nova proposta notificada para ${notifiedCount} conexões no boosting ${boostingId}`);
    } catch (error) {
      logger.error('Erro ao notificar nova proposta:', error);
    }
  }

  /**
   * Notifica sobre atualização de uma proposta existente
   */
  notifyProposalUpdate(boostingId, proposalData) {
    try {
      if (!this.boostingSubscriptions.has(boostingId)) {
        return;
      }

      const subscribers = this.boostingSubscriptions.get(boostingId);
      
      subscribers.forEach(userId => {
        const connections = this.connectionManager.getUserConnections(userId);
        
        connections.forEach(ws => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'proposal:updated',
              data: {
                boostingId,
                proposal: proposalData,
                timestamp: new Date().toISOString()
              }
            }));
          }
        });
      });

      logger.info(`🔄 Proposta atualizada notificada para boosting ${boostingId}`);
    } catch (error) {
      logger.error('Erro ao notificar atualização de proposta:', error);
    }
  }

  /**
   * Quando usuário se desconecta, remover de todas as inscrições
   */
  onUserDisconnect(userId) {
    try {
      // Remover usuário de todas as inscrições
      this.boostingSubscriptions.forEach((subscribers, boostingId) => {
        if (subscribers.has(userId)) {
          subscribers.delete(userId);
          
          // Limpar set vazio
          if (subscribers.size === 0) {
            this.boostingSubscriptions.delete(boostingId);
          }
        }
      });

      logger.info(`ProposalHandler: User ${userId} disconnected and unsubscribed from all boostings`);
    } catch (error) {
      logger.error('Erro ao desconectar usuário do ProposalHandler:', error);
    }
  }
}

module.exports = ProposalHandler;

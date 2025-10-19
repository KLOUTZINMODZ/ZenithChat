/**
 * ProposalHandler - Gerencia eventos de propostas via WebSocket
 * Implementa padrão Eldorado: uma conversa por proposta
 */

const logger = require('../../utils/logger');
const Conversation = require('../../models/Conversation');

class ProposalHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    // Map: boostingId -> Set<userId>
    this.boostingSubscriptions = new Map();
    logger.info('ProposalHandler initialized with subscription system');
  }

  /**
   * Registra eventos de proposta para uma conexão WebSocket
   */
  registerEvents(ws) {
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'proposal:subscribe':
            this.handleSubscribe(ws, message);
            break;
          case 'proposal:unsubscribe':
            this.handleUnsubscribe(ws, message);
            break;
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
   * Inscreve usuário para receber atualizações de um boosting
   */
  handleSubscribe(ws, message) {
    try {
      const { boostingId } = message;
      const userId = ws.userId;

      if (!boostingId) {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'boostingId is required for subscription'
        }));
        return;
      }

      if (!userId) {
        logger.error('Attempt to subscribe without userId');
        return;
      }

      // Criar set se não existir
      if (!this.boostingSubscriptions.has(boostingId)) {
        this.boostingSubscriptions.set(boostingId, new Set());
      }

      // Adicionar userId ao set
      this.boostingSubscriptions.get(boostingId).add(userId.toString());

      logger.info(`User ${userId} subscribed to boosting ${boostingId}. Total subscribers: ${this.boostingSubscriptions.get(boostingId).size}`);

      // Confirmar inscrição
      ws.send(JSON.stringify({
        type: 'proposal:subscribed',
        boostingId,
        timestamp: new Date().toISOString()
      }));

    } catch (error) {
      logger.error('Error in handleSubscribe:', error);
    }
  }

  /**
   * Cancela inscrição de usuário
   */
  handleUnsubscribe(ws, message) {
    try {
      const { boostingId } = message;
      const userId = ws.userId;

      if (!boostingId || !userId) return;

      const subscribers = this.boostingSubscriptions.get(boostingId);
      if (subscribers) {
        subscribers.delete(userId.toString());

        logger.info(`User ${userId} unsubscribed from boosting ${boostingId}`);

        // Remover set vazio
        if (subscribers.size === 0) {
          this.boostingSubscriptions.delete(boostingId);
          logger.info(`No more subscribers for boosting ${boostingId}, removed from map`);
        }
      }

      // Confirmar cancelamento
      ws.send(JSON.stringify({
        type: 'proposal:unsubscribed',
        boostingId,
        timestamp: new Date().toISOString()
      }));

    } catch (error) {
      logger.error('Error in handleUnsubscribe:', error);
    }
  }

  /**
   * Broadcast: Nova proposta criada
   */
  broadcastNewProposal(boostingId, proposal) {
    try {
      const subscribers = this.boostingSubscriptions.get(boostingId);
      
      if (!subscribers || subscribers.size === 0) {
        logger.debug(`No subscribers for boosting ${boostingId}, skipping broadcast`);
        return;
      }

      const message = JSON.stringify({
        type: 'proposal:new',
        boostingId,
        data: { 
          proposal: proposal.toObject ? proposal.toObject() : proposal
        },
        timestamp: new Date().toISOString()
      });

      logger.info(`Broadcasting new proposal to ${subscribers.size} subscribers of boosting ${boostingId}`);

      let broadcastCount = 0;
      subscribers.forEach(userId => {
        const connections = this.connectionManager.getUserConnections(userId);
        connections.forEach(conn => {
          if (conn.readyState === 1) {
            try {
              conn.send(message);
              broadcastCount++;
            } catch (error) {
              logger.error(`Error broadcasting to user ${userId}:`, error);
            }
          }
        });
      });

      logger.info(`Successfully broadcasted new proposal to ${broadcastCount} connections`);

    } catch (error) {
      logger.error('Error in broadcastNewProposal:', error);
    }
  }

  /**
   * Broadcast: Proposta atualizada
   */
  broadcastProposalUpdated(boostingId, proposal) {
    try {
      const subscribers = this.boostingSubscriptions.get(boostingId);
      if (!subscribers || subscribers.size === 0) return;

      const message = JSON.stringify({
        type: 'proposal:updated',
        boostingId,
        data: { 
          proposal: proposal.toObject ? proposal.toObject() : proposal
        },
        timestamp: new Date().toISOString()
      });

      logger.info(`Broadcasting updated proposal to ${subscribers.size} subscribers`);

      subscribers.forEach(userId => {
        const connections = this.connectionManager.getUserConnections(userId);
        connections.forEach(conn => {
          if (conn.readyState === 1) {
            try {
              conn.send(message);
            } catch (error) {
              logger.error(`Error broadcasting update:`, error);
            }
          }
        });
      });

    } catch (error) {
      logger.error('Error in broadcastProposalUpdated:', error);
    }
  }

  /**
   * Broadcast: Proposta rejeitada
   */
  broadcastProposalRejected(boostingId, proposalId) {
    try {
      const subscribers = this.boostingSubscriptions.get(boostingId);
      if (!subscribers || subscribers.size === 0) return;

      const message = JSON.stringify({
        type: 'proposal:rejected',
        boostingId,
        data: { proposalId },
        timestamp: new Date().toISOString()
      });

      logger.info(`Broadcasting proposal rejected to ${subscribers.size} subscribers`);

      subscribers.forEach(userId => {
        const connections = this.connectionManager.getUserConnections(userId);
        connections.forEach(conn => {
          if (conn.readyState === 1) {
            try {
              conn.send(message);
            } catch (error) {
              logger.error(`Error broadcasting rejection:`, error);
            }
          }
        });
      });

    } catch (error) {
      logger.error('Error in broadcastProposalRejected:', error);
    }
  }

  /**
   * Broadcast: Proposta cancelada
   */
  broadcastProposalCancelled(boostingId, proposalId) {
    try {
      const subscribers = this.boostingSubscriptions.get(boostingId);
      if (!subscribers || subscribers.size === 0) return;

      const message = JSON.stringify({
        type: 'proposal:cancelled',
        boostingId,
        data: { proposalId },
        timestamp: new Date().toISOString()
      });

      logger.info(`Broadcasting proposal cancelled to ${subscribers.size} subscribers`);

      subscribers.forEach(userId => {
        const connections = this.connectionManager.getUserConnections(userId);
        connections.forEach(conn => {
          if (conn.readyState === 1) {
            try {
              conn.send(message);
            } catch (error) {
              logger.error(`Error broadcasting cancellation:`, error);
            }
          }
        });
      });

    } catch (error) {
      logger.error('Error in broadcastProposalCancelled:', error);
    }
  }

  /**
   * Broadcast: Pedido de boosting cancelado
   */
  broadcastBoostingCancelled(boostingId) {
    try {
      const subscribers = this.boostingSubscriptions.get(boostingId);
      if (!subscribers || subscribers.size === 0) {
        logger.debug(`No subscribers for cancelled boosting ${boostingId}`);
        return;
      }

      const message = JSON.stringify({
        type: 'boosting:cancelled',
        boostingId,
        timestamp: new Date().toISOString()
      });

      logger.info(`Broadcasting boosting cancelled to ${subscribers.size} subscribers`);

      subscribers.forEach(userId => {
        const connections = this.connectionManager.getUserConnections(userId);
        connections.forEach(conn => {
          if (conn.readyState === 1) {
            try {
              conn.send(message);
            } catch (error) {
              logger.error(`Error broadcasting boosting cancellation:`, error);
            }
          }
        });
      });

      // Limpar inscrições
      this.boostingSubscriptions.delete(boostingId);
      logger.info(`Cleaned up subscriptions for cancelled boosting ${boostingId}`);

    } catch (error) {
      logger.error('Error in broadcastBoostingCancelled:', error);
    }
  }

  /**
   * Obtém estatísticas
   */
  getStats() {
    const stats = {
      totalBoostings: this.boostingSubscriptions.size,
      boostings: []
    };

    this.boostingSubscriptions.forEach((subscribers, boostingId) => {
      stats.boostings.push({
        boostingId,
        subscribers: subscribers.size
      });
    });

    return stats;
  }

  /**
   * Quando usuário se desconecta
   */
  onUserDisconnect(userId) {
    logger.info(`ProposalHandler: User ${userId} disconnecting, cleaning up subscriptions`);
    
    // Remover usuário de todas as inscrições
    let removedCount = 0;
    this.boostingSubscriptions.forEach((subscribers, boostingId) => {
      if (subscribers.has(userId.toString())) {
        subscribers.delete(userId.toString());
        removedCount++;
        
        // Remover set vazio
        if (subscribers.size === 0) {
          this.boostingSubscriptions.delete(boostingId);
        }
      }
    });

    if (removedCount > 0) {
      logger.info(`Removed user ${userId} from ${removedCount} boosting subscriptions`);
    }
  }
}

module.exports = ProposalHandler;

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

      logger.info(`[ProposalHandler] Processando proposta aceita: ${proposalId}`);

      const conversation = await Conversation.findOne({
        proposalId: proposalId
      });

      if (!conversation) {
        logger.error(`Conversa não encontrada para proposalId: ${proposalId}`);
        return;
      }

      logger.info(`[ProposalHandler] Conversa encontrada: ${conversation._id}`);

      // ✅ Atualizar conversa
      conversation.isTemporary = false;
      conversation.status = 'accepted';
      conversation.boostingStatus = 'in_progress'; // Alterado de 'active' para 'in_progress'
      conversation.expiresAt = null;
      
      await conversation.save();

      logger.info(`[ProposalHandler] Conversa atualizada: status=${conversation.status}, isTemporary=${conversation.isTemporary}`);

      const participants = conversation.participants;
      
      // ✅ Evento 1: Notificar ambos os participantes que proposta foi aceita
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
                boostingStatus: 'in_progress',
                message: 'Proposta aceita! Chat convertido para permanente.'
              }
            }));
          }
        });
      });

      logger.info(`[ProposalHandler] Evento proposal:accepted enviado para ${participants.length} participantes`);

      // ✅ Evento 2: Atualizar conversa em tempo real
      participants.forEach(participantId => {
        const connections = this.connectionManager.getUserConnections(participantId.toString());
        
        connections.forEach(connection => {
          if (connection.readyState === 1) {
            connection.send(JSON.stringify({
              type: 'conversation:updated',
              data: {
                conversationId: conversation._id,
                status: 'accepted',
                isTemporary: false,
                boostingStatus: 'in_progress',
                action: 'status_updated',
                conversation: {
                  _id: conversation._id,
                  status: conversation.status,
                  isTemporary: conversation.isTemporary,
                  boostingStatus: conversation.boostingStatus
                }
              }
            }));
          }
        });
      });

      logger.info(`[ProposalHandler] Evento conversation:updated enviado para ${participants.length} participantes`);

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

        // Remover set vazio
        if (subscribers.size === 0) {
          this.boostingSubscriptions.delete(boostingId);
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

      // Broadcasted new proposal

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

      // Broadcasting updated proposal

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
      if (!subscribers || subscribers.size === 0) {
        logger.warn(`[ProposalHandler] Nenhum subscriber para boostingId: ${boostingId}`);
        return;
      }

      const message = JSON.stringify({
        type: 'proposal:rejected',
        boostingId,
        data: { 
          proposalId,
          boostingId // ✅ Incluir boostingId para validação no frontend
        },
        timestamp: new Date().toISOString()
      });

      let broadcastCount = 0;
      subscribers.forEach(userId => {
        const connections = this.connectionManager.getUserConnections(userId);
        connections.forEach(conn => {
          if (conn.readyState === 1) {
            try {
              conn.send(message);
              broadcastCount++;
            } catch (error) {
              logger.error(`Error broadcasting rejection to user ${userId}:`, error);
            }
          }
        });
      });

      logger.info(`[ProposalHandler] Broadcast de proposta rejeitada enviado para ${broadcastCount} conexões (boostingId: ${boostingId}, proposalId: ${proposalId})`);

    } catch (error) {
      logger.error('Error in broadcastProposalRejected:', error);
    }
  }

  /**
   * Broadcast: Proposta aceita
   * @param {string} boostingId - ID do boosting
   * @param {string} proposalId - ID da proposta
   * @param {string} conversationId - ID da conversa
   * @param {object} modalData - Dados completos para atualizar o modal (opcional)
   */
  broadcastProposalAccepted(boostingId, proposalId, conversationId, modalData = null) {
    try {
      const subscribers = this.boostingSubscriptions.get(boostingId);
      if (!subscribers || subscribers.size === 0) {
        logger.warn(`[ProposalHandler] Nenhum subscriber para boostingId: ${boostingId}`);
        return;
      }

      // ✅ Evento 1: Notificar que proposta foi aceita (com dados do modal se disponível)
      const proposalAcceptedMessage = JSON.stringify({
        type: 'proposal:accepted',
        boostingId,
        data: { 
          proposalId,
          conversationId,
          status: 'accepted',
          boostingId,
          // ✅ Incluir dados completos do modal para atualização em tempo real
          ...(modalData && {
            price: modalData.price,
            estimatedTime: modalData.estimatedTime,
            message: modalData.message,
            isTemporary: false,
            clientName: modalData.clientName,
            boosterName: modalData.boosterName,
            clientAvatar: modalData.clientAvatar,
            boosterAvatar: modalData.boosterAvatar,
            game: modalData.game,
            category: modalData.category,
            acceptedAt: modalData.acceptedAt
          })
        },
        timestamp: new Date().toISOString()
      });

      // ✅ Evento 2: Remover proposta da lista (para ambos os usuários)
      const proposalRemovedMessage = JSON.stringify({
        type: 'proposal:removed',
        boostingId,
        data: { 
          proposalId,
          reason: 'accepted',
          boostingId
        },
        timestamp: new Date().toISOString()
      });

      let broadcastCount = 0;
      subscribers.forEach(userId => {
        const connections = this.connectionManager.getUserConnections(userId);
        connections.forEach(conn => {
          if (conn.readyState === 1) {
            try {
              // Enviar ambos os eventos
              conn.send(proposalAcceptedMessage);
              conn.send(proposalRemovedMessage);
              broadcastCount++;
            } catch (error) {
              logger.error(`Error broadcasting acceptance to user ${userId}:`, error);
            }
          }
        });
      });

      logger.info(`[ProposalHandler] Broadcast de proposta aceita enviado para ${broadcastCount} conexões (boostingId: ${boostingId}, proposalId: ${proposalId})`);

    } catch (error) {
      logger.error('Error in broadcastProposalAccepted:', error);
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

      // Broadcasting proposal cancelled

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
        return;
      }

      const message = JSON.stringify({
        type: 'boosting:cancelled',
        boostingId,
        timestamp: new Date().toISOString()
      });

      // Broadcasting boosting cancelled

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

    // Subscriptions cleaned up
  }
}

module.exports = ProposalHandler;

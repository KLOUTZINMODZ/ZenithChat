/**
 * ProposalHandler - Gerencia eventos de propostas via WebSocket
 * Implementa padrão Eldorado: uma conversa por proposta
 */

const logger = require('../../utils/logger');
const Conversation = require('../../models/Conversation');

class ProposalHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
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
   * Quando usuário se desconecta
   */
  onUserDisconnect(userId) {
    logger.info(`ProposalHandler: User ${userId} disconnected`);
  }
}

module.exports = ProposalHandler;

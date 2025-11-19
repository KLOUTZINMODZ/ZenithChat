/**
 * Serviço de fila de retentativas para operações que possam falhar
 * e precisem ser executadas novamente posteriormente
 */
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Definição do schema para a fila de retentativas
const retrySchema = new mongoose.Schema({
  taskType: {
    type: String,
    required: true,
    index: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 5
  },
  lastAttempt: {
    type: Date
  },
  nextAttempt: {
    type: Date,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  error: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

retrySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Criação do modelo
const RetryTask = mongoose.model('RetryTask', retrySchema);

/**
 * Serviço para gerenciar a fila de retentativas
 */
class RetryQueue {
  /**
   * Adiciona uma tarefa à fila de retentativas
   * @param {string} taskType - Tipo de tarefa (ex: create_agreement_from_proposal)
   * @param {Object} payload - Dados necessários para executar a tarefa
   * @param {number} delaySeconds - Atraso em segundos até a primeira tentativa
   * @param {number} maxAttempts - Número máximo de tentativas
   */
  static async enqueue(taskType, payload, delaySeconds = 60, maxAttempts = 5) {
    try {
      // Calcular próxima tentativa
      const nextAttempt = new Date();
      nextAttempt.setSeconds(nextAttempt.getSeconds() + delaySeconds);

      // Criar tarefa
      const task = new RetryTask({
        taskType,
        payload,
        maxAttempts,
        nextAttempt,
        status: 'pending'
      });

      await task.save();
      logger.info(`✅ Tarefa enfileirada para retry: ${taskType}`, { taskId: task._id });
      
      return task;
    } catch (error) {
      logger.error(`❌ Erro ao enfileirar tarefa: ${error.message}`, { taskType, error });
      throw error;
    }
  }

  /**
   * Processa tarefas pendentes na fila
   * @returns {Promise<number>} Número de tarefas processadas
   */
  static async processPendingTasks() {
    try {
      // Buscar tarefas pendentes que devem ser executadas agora
      const tasks = await RetryTask.find({
        status: 'pending',
        nextAttempt: { $lte: new Date() }
      }).limit(10).sort({ nextAttempt: 1 });

      logger.info(`Encontradas ${tasks.length} tarefas pendentes para processamento`);
      
      let processed = 0;
      
      for (const task of tasks) {
        try {
          // Marcar como em processamento para evitar execução duplicada
          task.status = 'processing';
          task.lastAttempt = new Date();
          task.attempts += 1;
          await task.save();
          
          // Executar tarefa de acordo com o tipo
          await this.executeTask(task);
          
          // Marcar como concluída
          task.status = 'completed';
          await task.save();
          
          processed++;
          logger.info(`✅ Tarefa processada com sucesso: ${task.taskType}`, { taskId: task._id });
        } catch (error) {
          // Verificar se atingiu número máximo de tentativas
          if (task.attempts >= task.maxAttempts) {
            task.status = 'failed';
            task.error = error.message;
            await task.save();
            
            logger.error(`❌ Tarefa falhou após ${task.attempts} tentativas: ${error.message}`, { 
              taskId: task._id, 
              taskType: task.taskType 
            });
          } else {
            // Calcular próxima tentativa com backoff exponencial
            const backoffMinutes = Math.pow(2, task.attempts);
            const nextAttempt = new Date();
            nextAttempt.setMinutes(nextAttempt.getMinutes() + backoffMinutes);
            
            task.status = 'pending';
            task.nextAttempt = nextAttempt;
            task.error = error.message;
            await task.save();
            
            logger.warn(`⚠️ Erro ao processar tarefa (tentativa ${task.attempts}/${task.maxAttempts}): ${error.message}. Próxima tentativa em ${backoffMinutes} minutos`, { 
              taskId: task._id, 
              taskType: task.taskType,
              nextAttempt
            });
          }
        }
      }
      
      return processed;
    } catch (error) {
      logger.error(`❌ Erro ao processar fila de retry: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Executa uma tarefa específica baseada no tipo
   * @param {Object} task - Tarefa a ser executada
   */
  static async executeTask(task) {
    const { taskType, payload } = task;
    
    switch (taskType) {
      case 'create_agreement_from_proposal':
        await this.createAgreementFromProposal(payload);
        break;
        
      // Adicionar outros tipos de tarefas aqui
        
      default:
        throw new Error(`Tipo de tarefa desconhecido: ${taskType}`);
    }
  }

  /**
   * Cria um Agreement a partir de uma proposta aceita
   */
  static async createAgreementFromProposal(payload) {
    const { conversationId, proposalId, acceptedProposalId, userId } = payload;
    
    // Importar modelos
    const Conversation = require('../models/Conversation');
    const AcceptedProposal = require('../models/AcceptedProposal');
    const Agreement = require('../models/Agreement');
    const BoostingOrder = require('../models/BoostingOrder');
    
    // Verificar se já existe um Agreement para esta proposta
    const existingAgreement = await Agreement.findOne({
      $or: [
        { proposalId },
        { acceptedProposalId },
        { conversationId }
      ]
    });
    
    if (existingAgreement) {
      logger.info(`Agreement já existe para a proposta: ${existingAgreement.agreementId}`);
      return existingAgreement;
    }
    
    // Buscar conversa e proposta aceita
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversa não encontrada: ${conversationId}`);
    }
    
    const acceptedProposal = await AcceptedProposal.findById(acceptedProposalId);
    if (!acceptedProposal) {
      throw new Error(`Proposta aceita não encontrada: ${acceptedProposalId}`);
    }
    
    // Obter dados necessários
    const proposalData = acceptedProposal.proposalData || conversation.metadata?.get('proposalData');
    const clientData = acceptedProposal.clientData || conversation.metadata?.get('clientData');
    const boosterData = acceptedProposal.boosterData || conversation.metadata?.get('boosterData');
    
    if (!proposalData || !clientData || !boosterData) {
      throw new Error('Dados insuficientes para criar Agreement');
    }
    
    // Converter preço
    const _priceValue = typeof proposalData.price === 'string'
      ? parseFloat(proposalData.price.replace(/\./g, '').replace(',', '.'))
      : Number(proposalData.price || 0);
    
    // Criar Agreement
    const agreement = new Agreement({
      conversationId,
      proposalId,
      acceptedProposalId,
      proposalSnapshot: {
        game: proposalData.game || 'N/A',
        category: proposalData.category || 'Boosting',
        currentRank: proposalData.currentRank || 'N/A',
        desiredRank: proposalData.desiredRank || 'N/A',
        description: proposalData.description || '',
        price: _priceValue,
        originalPrice: _priceValue,
        estimatedTime: proposalData.estimatedTime || ''
      },
      parties: {
        client: {
          userid: clientData.userid,
          name: clientData.name,
          email: clientData.email || '',
          avatar: clientData.avatar || '',
          metadata: new Map([
            ['isVerified', clientData.isVerified || false]
          ])
        },
        booster: {
          userid: boosterData.userid,
          name: boosterData.name,
          email: boosterData.email || '',
          avatar: boosterData.avatar || '',
          metadata: new Map([
            ['rating', boosterData.rating || 0]
          ])
        }
      },
      financial: {
        totalAmount: _priceValue,
        currency: 'BRL',
        paymentStatus: 'pending'
      },
      status: 'active'
    });
    
    agreement.addAction('created', userId, { proposalId });
    await agreement.save();
    
    logger.info(`✅ Agreement criado com sucesso: ${agreement.agreementId}`);
    
    // Atualizar conversa com agreementId
    conversation.agreementId = agreement.agreementId;
    conversation.metadata = conversation.metadata || new Map();
    conversation.metadata.set('latestAgreementId', agreement.agreementId);
    await conversation.save();
    
    // Tentar criar BoostingOrder
    try {
      const boostingOrder = await BoostingOrder.createFromAgreement(agreement);
      logger.info(`✅ BoostingOrder criado com sucesso: ${boostingOrder._id}`);
    } catch (boError) {
      logger.error(`❌ Erro ao criar BoostingOrder: ${boError.message}`, { 
        agreementId: agreement.agreementId, 
        error: boError.message 
      });
      // Não falhar se BoostingOrder falhar
    }
    
    return agreement;
  }
}

module.exports = RetryQueue;

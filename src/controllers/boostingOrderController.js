const BoostingOrder = require('../models/BoostingOrder');
const Agreement = require('../models/Agreement');
const User = require('../models/User');

/**
 * Buscar boosting order por ID (_id ou agreementId)
 * Similar ao getAgreement, mas com fallback para Agreement se BoostingOrder não existir
 */
async function getBoostingOrder(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
    }

    // Tentar buscar BoostingOrder primeiro
    let boostingOrder = await BoostingOrder.findById(orderId);

    // Se não encontrar por _id, tentar por agreementId
    if (!boostingOrder) {
      boostingOrder = await BoostingOrder.findOne({ agreementId: orderId });
    }

    // Se ainda não encontrar, tentar buscar Agreement e criar BoostingOrder
    if (!boostingOrder) {
      console.log(`BoostingOrder não encontrado, buscando Agreement: ${orderId}`);

      let agreement = await Agreement.findByAgreementId(orderId);

      if (!agreement) {
        agreement = await Agreement.findById(orderId);
      }

      if (!agreement) {
        return res.status(404).json({
          success: false,
          message: 'Pedido de boosting não encontrado'
        });
      }

      // Verificar se usuário é participante
      const isParticipant =
        agreement.parties.client.userid.toString() === userId.toString() ||
        agreement.parties.booster.userid.toString() === userId.toString();

      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'Acesso negado ao pedido' });
      }

      // Criar BoostingOrder a partir do Agreement
      try {
        boostingOrder = await BoostingOrder.createFromAgreement(agreement);
        console.log('BoostingOrder criado a partir de Agreement durante consulta');
      } catch (createError) {
        console.error('Erro ao criar BoostingOrder:', createError);
        // Se falhar, retornar dados do Agreement diretamente
        return res.json({
          success: true,
          data: {
            _id: agreement._id,
            orderNumber: agreement.agreementId,
            agreementId: agreement.agreementId,
            boostingRequestId: agreement.boostingRequestId,
            conversationId: agreement.conversationId,
            clientId: agreement.parties.client.userid,
            boosterId: agreement.parties.booster.userid,
            clientData: {
              name: agreement.parties.client.name,
              email: agreement.parties.client.email,
              avatar: agreement.parties.client.avatar
            },
            boosterData: {
              name: agreement.parties.booster.name,
              email: agreement.parties.booster.email,
              avatar: agreement.parties.booster.avatar,
              rating: agreement.parties.booster.rating
            },
            status: agreement.status,
            price: agreement.proposalSnapshot?.price || agreement.price || 0,
            serviceSnapshot: {
              game: agreement.proposalSnapshot.game,
              category: agreement.proposalSnapshot.category,
              currentRank: agreement.proposalSnapshot.currentRank,
              desiredRank: agreement.proposalSnapshot.desiredRank,
              description: agreement.proposalSnapshot.description,
              estimatedTime: agreement.proposalSnapshot.estimatedTime
            },
            createdAt: agreement.createdAt,
            activatedAt: agreement.activatedAt,
            completedAt: agreement.completedAt,
            cancelledAt: agreement.cancelledAt
          }
        });
      }
    }

    // Verificar se usuário é participante do BoostingOrder
    const isParticipant =
      boostingOrder.clientId.toString() === userId.toString() ||
      boostingOrder.boosterId.toString() === userId.toString();

    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Acesso negado ao pedido' });
    }

    res.json({
      success: true,
      data: boostingOrder
    });
  } catch (error) {
    console.error('Erro ao buscar boosting order:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
}

async function getBoostingOrderByConversation(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
    }

    if (!conversationId) {
      return res.status(400).json({ success: false, message: 'conversationId é obrigatório' });
    }

    let boostingOrder = await BoostingOrder.findOne({ conversationId });

    if (!boostingOrder) {
      const agreement = await Agreement.findOne({ conversationId });
      if (!agreement) {
        return res.status(404).json({ success: false, message: 'Pedido de boosting não encontrado para esta conversa' });
      }

      const isParticipant =
        agreement.parties.client.userid.toString() === userId.toString() ||
        agreement.parties.booster.userid.toString() === userId.toString();

      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'Acesso negado ao pedido' });
      }

      try {
        boostingOrder = await BoostingOrder.createFromAgreement(agreement);
      } catch (createError) {
        console.error('Erro ao criar BoostingOrder a partir de Agreement (fallback para snapshot):', createError.message);

        return res.json({
          success: true,
          data: {
            _id: agreement._id,
            orderNumber: agreement.agreementId,
            agreementId: agreement.agreementId,
            boostingRequestId: agreement.boostingRequestId,
            conversationId: agreement.conversationId,
            clientId: agreement.parties.client.userid,
            boosterId: agreement.parties.booster.userid,
            clientData: {
              name: agreement.parties.client.name,
              email: agreement.parties.client.email,
              avatar: agreement.parties.client.avatar
            },
            boosterData: {
              name: agreement.parties.booster.name,
              email: agreement.parties.booster.email,
              avatar: agreement.parties.booster.avatar,
              rating: agreement.parties.booster.rating
            },
            status: agreement.status,
            price: agreement.proposalSnapshot?.price || agreement.price || 0,
            serviceSnapshot: {
              game: agreement.proposalSnapshot.game,
              category: agreement.proposalSnapshot.category,
              currentRank: agreement.proposalSnapshot.currentRank,
              desiredRank: agreement.proposalSnapshot.desiredRank,
              description: agreement.proposalSnapshot.description,
              estimatedTime: agreement.proposalSnapshot.estimatedTime
            },
            createdAt: agreement.createdAt,
            activatedAt: agreement.activatedAt,
            completedAt: agreement.completedAt,
            cancelledAt: agreement.cancelledAt
          }
        });
      }
    } else {
      const isParticipant =
        boostingOrder.clientId.toString() === userId.toString() ||
        boostingOrder.boosterId.toString() === userId.toString();

      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'Acesso negado ao pedido' });
      }
    }

    return res.json({ success: true, data: boostingOrder });
  } catch (error) {
    console.error('Erro ao buscar boosting order por conversa:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
}

/**
 * Listar boosting orders do usuário
 */
async function listBoostingOrders(req, res) {
  try {
    const userId = req.user?.id || req.user?._id;
    const { type, status, page = 1, limit = 10 } = req.query;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
    }

    const query = {};

    // Filtrar por tipo (cliente ou booster)
    if (type === 'purchases') {
      query.clientId = userId;
    } else if (type === 'sales') {
      query.boosterId = userId;
    } else {
      query.$or = [
        { clientId: userId },
        { boosterId: userId }
      ];
    }

    // Filtrar por status
    if (status && status !== 'all') {
      const statuses = status.split(',').map(s => s.trim().toLowerCase());
      query.status = { $in: statuses };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [orders, total] = await Promise.all([
      BoostingOrder.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      BoostingOrder.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Erro ao listar boosting orders:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
}

module.exports = {
  getBoostingOrder,
  listBoostingOrders,
  getBoostingOrderByConversation
};

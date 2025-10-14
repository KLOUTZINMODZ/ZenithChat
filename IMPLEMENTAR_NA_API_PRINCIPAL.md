# 🚀 Implementação Necessária na API Principal (zenithapi)

## 🎯 O Que Implementar

Nova rota para aceitar propostas usando `boostingId` + `boosterId` (em vez de `proposalId`).

---

## 📝 Código Completo

### **Arquivo:** `src/routes/boostingRoutes.js` (ou similar)

```javascript
/**
 * @route   POST /api/boosting-requests/:boostingId/accept-proposal
 * @desc    Aceita proposta de um booster para um boosting request
 * @access  Private (Client only)
 */
router.post('/:boostingId/accept-proposal', authenticateToken, async (req, res) => {
  try {
    const { boostingId } = req.params;
    const { boosterId, conversationId, clientId, metadata } = req.body;
    
    console.log(`🔍 [Accept Proposal] Request:`, {
      boostingId,
      boosterId,
      clientId,
      userId: req.user.id
    });
    
    // 1. Validações
    if (!boosterId) {
      return res.status(400).json({
        success: false,
        message: 'boosterId é obrigatório'
      });
    }
    
    // 2. Busca boosting request
    const boostingRequest = await BoostingRequest.findById(boostingId);
    
    if (!boostingRequest) {
      return res.status(404).json({
        success: false,
        message: 'Boosting request não encontrado'
      });
    }
    
    // 3. Verifica se usuário é o dono do boosting
    if (boostingRequest.userId.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Você não tem permissão para aceitar propostas deste boosting'
      });
    }
    
    // 4. Verifica se boosting já foi aceito
    if (boostingRequest.status === 'in_progress' || boostingRequest.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Este boosting já possui uma proposta aceita',
        currentStatus: boostingRequest.status
      });
    }
    
    // 5. Busca proposta do booster
    const proposal = await Proposal.findOne({
      boostingRequestId: boostingId,
      boosterId: boosterId,
      status: 'pending'
    }).populate('boosterId', 'name email avatar rating');
    
    if (!proposal) {
      // Debug: mostra propostas disponíveis
      const allProposals = await Proposal.find({
        boostingRequestId: boostingId
      });
      
      console.error(`❌ [Accept Proposal] Proposta não encontrada:`, {
        boostingId,
        boosterId,
        availableProposals: allProposals.map(p => ({
          id: p._id,
          boosterId: p.boosterId,
          status: p.status
        }))
      });
      
      return res.status(404).json({
        success: false,
        message: 'Proposta não encontrada ou já foi processada',
        details: {
          boostingId,
          boosterId,
          hint: 'Verifique se a proposta está com status pending'
        }
      });
    }
    
    // 6. Inicia transação (se usar MongoDB transactions)
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // 7. Atualiza proposta para aceita
      proposal.status = 'accepted';
      proposal.acceptedAt = new Date();
      proposal.conversationId = conversationId; // Liga proposta ao chat
      await proposal.save({ session });
      
      // 8. Rejeita todas as outras propostas
      await Proposal.updateMany(
        {
          boostingRequestId: boostingId,
          _id: { $ne: proposal._id },
          status: 'pending'
        },
        {
          $set: {
            status: 'rejected',
            rejectedAt: new Date(),
            rejectionReason: 'Outra proposta foi aceita'
          }
        },
        { session }
      );
      
      // 9. Atualiza boosting request
      boostingRequest.status = 'in_progress';
      boostingRequest.acceptedProposalId = proposal._id;
      boostingRequest.acceptedBoosterId = boosterId;
      boostingRequest.conversationId = conversationId;
      boostingRequest.startedAt = new Date();
      await boostingRequest.save({ session });
      
      // 10. Commit transaction
      await session.commitTransaction();
      session.endSession();
      
      console.log(`✅ [Accept Proposal] Proposta aceita:`, {
        proposalId: proposal._id,
        boostingId,
        boosterId
      });
      
      // 11. Notificar booster (WebSocket, email, etc.)
      try {
        // Aqui você pode adicionar lógica de notificação
        // notificationService.notifyBooster(...)
      } catch (notifyError) {
        console.error('Erro ao notificar booster:', notifyError);
        // Não falha a requisição se notificação falhar
      }
      
      // 12. Retorna sucesso
      return res.json({
        success: true,
        message: 'Proposta aceita com sucesso',
        data: {
          proposal: {
            _id: proposal._id,
            status: proposal.status,
            acceptedAt: proposal.acceptedAt,
            price: proposal.price,
            estimatedTime: proposal.estimatedTime
          },
          boostingRequest: {
            _id: boostingRequest._id,
            status: boostingRequest.status,
            startedAt: boostingRequest.startedAt
          },
          booster: {
            _id: proposal.boosterId._id,
            name: proposal.boosterId.name,
            avatar: proposal.boosterId.avatar,
            rating: proposal.boosterId.rating
          }
        }
      });
      
    } catch (transactionError) {
      // Rollback em caso de erro
      await session.abortTransaction();
      session.endSession();
      throw transactionError;
    }
    
  } catch (error) {
    console.error('❌ [Accept Proposal] Erro:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao aceitar proposta',
      error: error.message
    });
  }
});
```

---

## 🗂️ Modelos Necessários

### **Proposal Model**

```javascript
const proposalSchema = new mongoose.Schema({
  boostingRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BoostingRequest',
    required: true,
    index: true
  },
  boosterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  price: {
    type: Number,
    required: true
  },
  estimatedTime: {
    type: String,
    required: true
  },
  message: String,
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
  acceptedAt: Date,
  rejectedAt: Date,
  rejectionReason: String,
  conversationId: String  // ID do chat
}, {
  timestamps: true
});

// Índice composto para busca rápida
proposalSchema.index({ boostingRequestId: 1, boosterId: 1, status: 1 });
```

### **BoostingRequest Model**

```javascript
const boostingRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  game: String,
  category: String,
  currentRank: String,
  desiredRank: String,
  description: String,
  status: {
    type: String,
    enum: ['open', 'in_progress', 'completed', 'cancelled'],
    default: 'open',
    index: true
  },
  acceptedProposalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Proposal'
  },
  acceptedBoosterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  conversationId: String,  // ID do chat
  startedAt: Date,
  completedAt: Date
}, {
  timestamps: true
});
```

---

## 🧪 Como Testar

### **1. Teste via cURL**

```bash
curl -X POST https://zenithapi-steel.vercel.app/api/boosting-requests/68ee950477bab05ae3f000d0/accept-proposal \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "boosterId": "6897d82c8cdd40188e08a224",
    "conversationId": "68ee9aa62533d6368c7c28cc",
    "clientId": "68a27017da1e592e29195df1"
  }'
```

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Proposta aceita com sucesso",
  "data": {
    "proposal": {
      "_id": "68ee9506a1b2c3d4e5f60001",
      "status": "accepted",
      "acceptedAt": "2025-10-14T19:00:00.000Z",
      "price": 300,
      "estimatedTime": "30 minutos"
    },
    "boostingRequest": {
      "_id": "68ee950477bab05ae3f000d0",
      "status": "in_progress",
      "startedAt": "2025-10-14T19:00:00.000Z"
    },
    "booster": {
      "_id": "6897d82c8cdd40188e08a224",
      "name": "Klouts (Allahu Teste)123",
      "avatar": "https://...",
      "rating": 4.8
    }
  }
}
```

---

### **2. Teste via Frontend**

Após implementar, apenas:
1. Reiniciar Chat API: `pm2 restart ZenithChat`
2. Recarregar frontend: `Ctrl+R`
3. Clicar em "Aceitar Boosting"

**Logs esperados no Chat API:**
```
🔗 [Proposal Accept] Using simplified endpoint
📊 [Proposal Accept] IDs: {
  boostingId: '68ee950477bab05ae3f000d0',
  boosterId: '6897d82c8cdd40188e08a224',
  clientId: '68a27017da1e592e29195df1'
}
🔗 [Proposal Accept] Forwarding to: https://zenithapi-steel.vercel.app/api/boosting-requests/68ee950477bab05ae3f000d0/accept-proposal
✅ [Proposal Accept] Zenith response: { success: true, ... }
```

---

## 📋 Checklist de Implementação

- [ ] Criar/atualizar models (Proposal, BoostingRequest)
- [ ] Adicionar rota `POST /boosting-requests/:id/accept-proposal`
- [ ] Testar com cURL
- [ ] Reiniciar Chat API
- [ ] Testar aceitação no frontend
- [ ] Verificar que outras propostas são rejeitadas
- [ ] Verificar que boosting muda para `in_progress`
- [ ] Testar notificações (se houver)

---

## ⚠️ Importante

### **Concorrência:**
A solução usa transactions do MongoDB para garantir que:
- ✅ Apenas UMA proposta seja aceita
- ✅ Todas as outras sejam rejeitadas automaticamente
- ✅ Status do boosting seja atualizado atomicamente

### **Rollback:**
Se algo falhar, a transaction é revertida automaticamente.

---

## 🎯 Após Implementar

**Chat API:** Já está pronto! ✅  
**Frontend:** Não precisa mudar! ✅  
**API Principal:** Implementar rota acima  

**Tempo estimado:** 30-45 minutos  
**Complexidade:** 🟢 BAIXA

---

**Status:** 🔴 Aguardando implementação  
**Prioridade:** 🔴 ALTA - Bloqueia funcionalidade core  
**Data:** 14/10/2025

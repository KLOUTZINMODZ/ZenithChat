# Sistema de Acordos (Agreement System)

## **Problema Resolvido**

**Problema Original:** Finalizar um pedido interferia quando o cliente aceitava outra proposta do mesmo booster.

**Causa:** Model `AcceptedProposal` tinha constraint `unique: true` no `conversationId`, permitindo apenas uma proposta por conversa.

## **Solução Implementada**

### **🏗️ Nova Arquitetura**

1. **Entidade Agreement Independente**
   - Cada proposta aceita = um Agreement único
   - Ciclo de vida próprio: `pending → active → completed|cancelled|expired`
   - Múltiplos Agreements por conversa permitidos
   - Chave única: `agreementId` (formato: `AGR_[timestamp]_[random]`)

2. **Desacoplamento Total**
   - Acordo pai vs acordos independentes
   - Finalizar um acordo não afeta outros
   - Controle de versão com optimistic locking
   - Idempotência em todas operações críticas

### **🔄 Migração Retrocompatível**

- **AcceptedProposal** mantido para compatibilidade
- Migração automática em endpoints existentes
- Contratos externos não quebram
- Transição transparente para clients

---

## **Estrutura de Dados**

### **Agreement Schema**

```javascript
{

  agreementId: "AGR_1640995200000_abc123xyz",
  conversationId: ObjectId,
  proposalId: ObjectId,
  acceptedProposalId: ObjectId,
  

  proposalSnapshot: {
    game: "League of Legends",
    category: "Elo Boost", 
    price: 150,
    estimatedTime: "3 dias",

  },
  

  parties: {
    client: { userid, name, email, metadata },
    booster: { userid, name, rating, metadata }
  },
  

  status: "active",
  version: 1,
  

  actionHistory: [{
    action: "created",
    performedBy: ObjectId,
    performedAt: Date,
    idempotencyKey: "migration_abc123"
  }],
  

  financial: {
    totalAmount: 150,
    currency: "BRL",
    paymentStatus: "pending"
  }
}
```

---

## **Endpoints**

### **Novos Endpoints (Agreement-based)**

```
POST   /api/agreements/create
GET    /api/agreements/:agreementId  
POST   /api/agreements/:agreementId/complete
POST   /api/agreements/:agreementId/cancel
POST   /api/agreements/:agreementId/renegotiate
GET    /api/agreements/conversation/:conversationId
GET    /api/agreements/user/me
```

### **Headers de Controle**

```
X-Idempotency-Key: unique-operation-key
Content-Type: application/json
```

### **Controle de Versão**

```json
{
  "version": 3,
  "data": { "newPrice": 200 }
}
```

**Response de Conflito:**
```json
{
  "success": false,
  "message": "Conflito de versão",
  "currentVersion": 4,
  "requestedVersion": 3
}
```

---

## **Compatibilidade**

### **Rotas Existentes (Mantidas)**

- `GET /boosting-chat/conversation/:id/proposal` ✅
- `POST /boosting-chat/conversation/:id/confirm-delivery` ✅  
- `POST /boosting-chat/conversation/:id/cancel` ✅
- `POST /boosting-chat/proposal/save` ✅ (Agora cria Agreement)

### **Migração Automática**

```javascript

const middleware = AgreementMigrationMiddleware.autoMigrate();


GET /boosting-chat/conversation/123/proposal
→ Cria Agreement baseado em AcceptedProposal existente
→ Resposta unificada (legacy + novo formato)
```

### **Resposta Dual**

```json
{
  "success": true,

  "proposal": { 
    "_id": "old_proposal_id",
    "price": 150,
    "status": "active"
  },

  "agreement": {
    "agreementId": "AGR_1640995200000_abc123",
    "status": "active", 
    "version": 1
  }
}
```

---

## **Operações Críticas**

### **1. Criar Nova Proposta**

**Antes:** ❌ Falha se já existir AcceptedProposal
```
Error: "Já existe uma proposta aceita para esta conversa"
```

**Depois:** ✅ Permite múltiplas propostas
```javascript
POST /boosting-chat/proposal/save


```

### **2. Finalizar Acordo**

**Antes:** ❌ Afetava toda a conversa
```javascript  
acceptedProposal.complete()
```

**Depois:** ✅ Finaliza apenas o acordo específico
```javascript
agreement.complete(userId, details, idempotencyKey)

```

### **3. Idempotência**

```javascript

POST /agreements/AGR_123/complete
Headers: X-Idempotency-Key: complete_123_20231201


{ "success": true, "message": "Já completado (idempotência)" }
```

---

## **Cenários de Uso**

### **Cenário 1: Cliente aceita nova proposta do mesmo booster**

1. **Estado inicial:**
   - Conversa já tem AcceptedProposal ativo
   - Primeiro acordo em andamento

2. **Nova proposta aceita:**
   ```javascript
   POST /boosting-chat/proposal/save


   ```

3. **Finalização independente:**
   ```javascript
   POST /agreements/AGR_primeiro/complete
   POST /agreements/AGR_segundo/complete

   ```

### **Cenário 2: Migração automática**

1. **Estado legacy:** Apenas AcceptedProposal existe
2. **Primeira requisição nova:**
   ```javascript
   GET /boosting-chat/conversation/123/proposal



   ```

---

## **Benefícios**

### **🎯 Resolução do Problema Principal**
- ✅ **Múltiplas propostas permitidas** por conversa
- ✅ **Finalização independente** de acordos
- ✅ **Zero interferência** entre acordos diferentes

### **🔒 Segurança e Confiabilidade** 
- ✅ **Idempotência** em operações críticas
- ✅ **Optimistic locking** previne race conditions  
- ✅ **Controle de versão** detecta conflitos
- ✅ **Histórico completo** de ações

### **🔄 Compatibilidade Total**
- ✅ **Migração transparente** sem downtime
- ✅ **Contratos existentes** mantidos
- ✅ **Frontend compatível** com ambos formatos
- ✅ **Rollback possível** se necessário

### **📈 Escalabilidade**
- ✅ **Performance otimizada** com índices específicos
- ✅ **Cache eficiente** por agreement_id
- ✅ **Queries paralelas** para múltiplos acordos

---

## **Status da Implementação**

- ✅ **Agreement Model** criado
- ✅ **AgreementController** implementado  
- ✅ **Middleware de migração** criado
- ✅ **Routes configuradas** 
- ✅ **BoostingChatController** atualizado
- ✅ **Migração automática** ativa
- ✅ **Retrocompatibilidade** garantida

**Sistema pronto para produção!** 🚀

# 🧪 Teste: Quais Rotas Existem na API Principal?

## 🎯 Objetivo

Descobrir qual endpoint usar para aceitar propostas.

---

## 🧪 Testes para Executar

Execute estes comandos no terminal para descobrir quais rotas existem:

### **Teste 1: Listar boosting request**
```bash
curl https://zenithapi-steel.vercel.app/api/boosting-requests/68ee950477bab05ae3f000d0 \
  -H "Authorization: Bearer SEU_TOKEN"
```

**O que procurar:** Estrutura do boosting, se tem campo `proposals`, `acceptedProposalId`, etc.

---

### **Teste 2: Tentar aceitar direto no boosting**
```bash
curl -X POST https://zenithapi-steel.vercel.app/api/boosting-requests/68ee950477bab05ae3f000d0/accept \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "boosterId": "6897d82c8cdd40188e08a224"
  }'
```

**O que procurar:** Se retorna 404, 405 ou funciona.

---

### **Teste 3: Verificar se existe rota de propostas**
```bash
curl https://zenithapi-steel.vercel.app/api/boosting-requests/68ee950477bab05ae3f000d0/proposals \
  -H "Authorization: Bearer SEU_TOKEN"
```

**O que procurar:** Lista de propostas, estrutura de resposta.

---

### **Teste 4: Tentar aceitar proposta específica (se houver ID real)**
```bash
curl -X POST https://zenithapi-steel.vercel.app/api/proposals/ID_REAL_AQUI/accept \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "68ee9aa62533d6368c7c28cc"
  }'
```

---

### **Teste 5: Buscar documentação da API**
```bash
# Possíveis endpoints de documentação:
curl https://zenithapi-steel.vercel.app/api/docs
curl https://zenithapi-steel.vercel.app/api/
curl https://zenithapi-steel.vercel.app/
```

---

## 🔍 Alternativa: Verificar Frontend

O **frontend já consegue enviar propostas**, então ele sabe qual endpoint usar!

Procure no frontend por:
```javascript
// Buscar no código do frontend:
"proposals" + "accept"
"boosting-requests" + "accept"
axios.post.*accept
```

**Arquivo provável:** 
- `src/services/boostingService.ts`
- `src/api/boosting.ts`
- `src/hooks/useBoosting.ts`

---

## 📊 Estruturas Possíveis

### **Opção A: Aceitar via boosting request**
```
POST /api/boosting-requests/:id/accept
Body: { boosterId, proposalId }
```

### **Opção B: Aceitar via proposta**
```
POST /api/proposals/:proposalId/accept
Body: { conversationId }
```

### **Opção C: Aceitar via endpoint específico**
```
POST /api/boosting/:id/accept-booster
Body: { boosterId }
```

---

## ⚡ Ação Rápida

**Execute este comando e me envie o resultado:**

```bash
curl https://zenithapi-steel.vercel.app/api/boosting-requests/68ee950477bab05ae3f000d0 \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

Com a resposta, conseguirei ver a estrutura e descobrir o endpoint correto!

---

**Criado:** 14/10/2025  
**Status:** Aguardando resultado dos testes

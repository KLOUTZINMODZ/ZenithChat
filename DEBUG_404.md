# 🔍 Debug: Erro 404 ao Aceitar Proposta

## 📊 Análise do Problema

**Erro no Frontend:**
```
POST https://zenith.enrelyugi.com.br/api/proposals/68ee950477bab05ae3f000d0_6897d82c8cdd40188e08a224_1760467621736/accept 404 (Not Found)
```

**Status:**
- ✅ Rota registrada corretamente: `app.use('/api/proposals', proposalRoutes)` (server.js:205)
- ✅ Handler implementado: `router.post('/:proposalId/accept', auth, ...)` (proposalRoutes.js:47)
- ❌ Servidor retorna 404 (rota não encontrada)

---

## 🔍 Checklist de Diagnóstico

### **1. Verificar se a requisição está chegando ao servidor**

No terminal do servidor, execute:
```bash
pm2 logs ZenithChat --lines 100
```

**O que procurar:**
- ✅ Se aparecer `🔍 [Proposal Accept] Received request for proposal:` → Requisição chegou
- ❌ Se NÃO aparecer NADA → Requisição não está chegando

---

### **2. Se a requisição NÃO está chegando:**

#### **Possível Causa A: Frontend está apontando para servidor errado**

Verifique no frontend (console do navegador):
```javascript
console.log('[Accept] URL:', chatApiUrl);
```

**Esperado:** `https://zenith.enrelyugi.com.br`

Se estiver diferente, o problema está na variável de ambiente `VITE_CHAT_API_URL`.

#### **Possível Causa B: Proxy/Load Balancer bloqueando**

Se você usa **Nginx, Cloudflare ou outro proxy**, verifique as configurações:

**Nginx exemplo:**
```nginx
location /api/proposals {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

#### **Possível Causa C: Firewall/CORS bloqueando**

Teste direto com curl:
```bash
curl -X POST https://zenith.enrelyugi.com.br/api/proposals/TEST_ID/accept \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"test","boosterId":"test","clientId":"test"}'
```

---

### **3. Se a requisição ESTÁ chegando mas retorna 404:**

#### **Possível Causa A: Middleware auth bloqueando**

O middleware `auth` pode estar retornando 404 em vez de 401/403.

**Solução:** Adicione log no início da rota:
```javascript
router.post('/:proposalId/accept', (req, res, next) => {
  console.log('🔍 [Proposal] Requisição recebida ANTES do auth:', req.params.proposalId);
  next();
}, auth, async (req, res) => {
  console.log('🔍 [Proposal] Requisição passou pelo auth');
  // ... resto do código
});
```

#### **Possível Causa B: Express não está carregando a rota**

Verifique se há erro ao iniciar o servidor:
```bash
pm2 logs ZenithChat --err --lines 50
```

Procure por erros como:
- `SyntaxError: Unexpected token`
- `Cannot find module`
- `Error loading route`

---

### **4. Verificar cache do servidor/browser**

#### **Cache do servidor:**
```bash
# No servidor
pm2 delete ZenithChat
pm2 start server.js --name ZenithChat
```

#### **Cache do browser:**
```
1. Abra DevTools (F12)
2. Clique com botão direito no botão de reload
3. Selecione "Empty Cache and Hard Reload"
```

---

## 🧪 Teste Rápido

### **Teste 1: Rota raiz**
```bash
curl https://zenith.enrelyugi.com.br/api/proposals
```

**Esperado:**
```json
{
  "message": "Proposals API",
  "endpoints": {
    "accept": "POST /:proposalId/accept"
  }
}
```

Se retornar 404, a rota `/api/proposals` não está registrada.

---

### **Teste 2: Rota de aceitação (sem auth)**

Temporariamente, remova o middleware `auth`:
```javascript
// TEMPORÁRIO PARA DEBUG
router.post('/:proposalId/accept', async (req, res) => {
  console.log('🔍 DEBUG: Requisição chegou!');
  res.json({ debug: true, proposalId: req.params.proposalId });
});
```

Reinicie e teste. Se funcionar, o problema é no `auth`.

---

## 📝 Informações Necessárias

Para continuar o debug, preciso de:

### **1. Logs do Servidor**
```bash
pm2 logs ZenithChat --lines 100
```

Copie e cole TUDO que aparecer quando você tentar aceitar a proposta.

### **2. Teste da Rota Raiz**
```bash
curl https://zenith.enrelyugi.com.br/api/proposals
```

Copie e cole a resposta.

### **3. Logs de Erro do Servidor**
```bash
pm2 logs ZenithChat --err --lines 50
```

Copie e cole qualquer erro que aparecer.

### **4. Teste com cURL**
```bash
# Substitua SEU_TOKEN pelo token JWT do localStorage
curl -X POST https://zenith.enrelyugi.com.br/api/proposals/TEST_ID/accept \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "test",
    "boosterId": "test",
    "clientId": "test",
    "metadata": {
      "boostingId": "test"
    }
  }' \
  -v
```

Copie e cole a resposta completa.

---

## 🎯 Próximos Passos

**COM os logs acima, poderei:**
1. ✅ Confirmar se a requisição está chegando
2. ✅ Identificar onde está sendo bloqueada
3. ✅ Ver a mensagem de erro exata do servidor
4. ✅ Corrigir o problema específico

**SEM os logs:**
- ❌ Só posso adivinhar possíveis causas
- ❌ Não consigo ver erros do servidor
- ❌ Não sei se a requisição está chegando

---

## 🚨 IMPORTANTE

**NÃO CONTINUE** tentando aceitar a proposta até termos os logs!

Cada tentativa pode gerar ruído nos logs e dificultar o diagnóstico.

---

**Aguardando:** Logs do servidor e resultados dos testes acima.

**Próximo passo:** Análise dos logs para identificar a causa exata do 404.

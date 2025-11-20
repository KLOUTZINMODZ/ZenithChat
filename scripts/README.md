# Scripts de Verificação de Cancelamento de Boosting

## 📋 Visão Geral

Dois scripts para verificar se todas as 4 collections estão sendo atualizadas corretamente durante o cancelamento de boosting:

1. **verify-cancellation.js** - Verificação única e completa
2. **monitor-collections.js** - Monitoramento em tempo real

---

## 🔍 Script 1: Verificação Única (verify-cancellation.js)

### Uso

```bash
node scripts/verify-cancellation.js <conversationId>
```

### Exemplo

```bash
node scripts/verify-cancellation.js 691f4d1f93574a269d24ddbf
```

### O que verifica

Verifica as 4 collections e mostra o status de cada uma:

```
═══════════════════════════════════════════════════════════
1️⃣  CONVERSATION
═══════════════════════════════════════════════════════════
✅ Encontrada
   isActive: false ✅
   boostingStatus: cancelled ✅
   status: cancelled ✅
   isFinalized: true ✅
   updatedAt: 2025-11-20T17:20:15.123Z

═══════════════════════════════════════════════════════════
2️⃣  AGREEMENT
═══════════════════════════════════════════════════════════
✅ Encontrado
   _id: AGR_1763659046539_t2ydvpocm
   status: cancelled ✅
   cancelledAt: 2025-11-20T17:20:15.456Z ✅
   updatedAt: 2025-11-20T17:20:15.456Z

═══════════════════════════════════════════════════════════
3️⃣  ACCEPTEDPROPOSAL
═══════════════════════════════════════════════════════════
✅ Encontrados 1 registro(s)

   [1] _id: 691f4d1f93574a269d24ddc2
       status: cancelled ✅
       cancelledAt: 2025-11-20T17:20:15.789Z ✅
       updatedAt: 2025-11-20T17:20:15.789Z

═══════════════════════════════════════════════════════════
4️⃣  BOOSTING_REQUESTS
═══════════════════════════════════════════════════════════
✅ Encontrado
   _id: 691f4d0e88b8991f7964ea60
   status: cancelled ✅
   cancelledAt: 2025-11-20T17:20:15.234Z ✅
   updatedAt: 2025-11-20T17:20:15.234Z

═══════════════════════════════════════════════════════════
5️⃣  BOOSTINGORDER (BÔNUS)
═══════════════════════════════════════════════════════════
✅ Encontrado
   _id: 691f4d1f93574a269d24ddc3
   status: cancelled ✅
   cancelledAt: 2025-11-20T17:20:15.567Z ✅
   updatedAt: 2025-11-20T17:20:15.567Z

═══════════════════════════════════════════════════════════
📋 RESUMO FINAL
═══════════════════════════════════════════════════════════
1️⃣  Conversation: ✅ OK
2️⃣  Agreement: ✅ OK
3️⃣  AcceptedProposal: ✅ OK
4️⃣  BoostingRequest: ✅ OK

✅ TODAS AS 4 COLLECTIONS FORAM ATUALIZADAS CORRETAMENTE!
```

### Saída

- **Exit code 0**: Todas as 4 collections foram atualizadas corretamente ✅
- **Exit code 1**: Alguma collection não foi atualizada ❌

---

## ⏱️ Script 2: Monitoramento em Tempo Real (monitor-collections.js)

### Uso

```bash
node scripts/monitor-collections.js <conversationId> [intervalo-em-segundos]
```

### Exemplos

```bash
# Verificar a cada 2 segundos (padrão)
node scripts/monitor-collections.js 691f4d1f93574a269d24ddbf

# Verificar a cada 5 segundos
node scripts/monitor-collections.js 691f4d1f93574a269d24ddbf 5

# Verificar a cada 1 segundo
node scripts/monitor-collections.js 691f4d1f93574a269d24ddbf 1
```

### O que faz

- Conecta ao MongoDB
- Verifica as 4 collections a cada intervalo especificado
- Atualiza a tela em tempo real
- Mostra quando todas as collections foram canceladas

### Saída

```
📊 MONITORAMENTO DE COLLECTIONS - Check #1
🔍 Conversation ID: 691f4d1f93574a269d24ddbf
⏱️  Intervalo: 2s

═══════════════════════════════════════════════════════════
1️⃣  CONVERSATION
═══════════════════════════════════════════════════════════
isActive: false ✅
boostingStatus: in_progress ❌
status: accepted ❌
isFinalized: false ❌
updatedAt: 2025-11-20T17:17:26.606Z

[... mais collections ...]

═══════════════════════════════════════════════════════════
⏳ AGUARDANDO CANCELAMENTO...
═══════════════════════════════════════════════════════════
```

### Parar o monitoramento

Pressione `Ctrl+C` para sair.

---

## 🔄 Fluxo de Teste Recomendado

### 1. Iniciar monitoramento em tempo real

```bash
# Terminal 1
node scripts/monitor-collections.js 691f4d1f93574a269d24ddbf 1
```

### 2. Cancelar boosting via API

```bash
# Terminal 2
curl -X POST http://localhost:3000/api/internal/boosting/691f4d1f93574a269d24ddbf/cancel \
  -H "Content-Type: application/json" \
  -d '{"reason":"Teste de cancelamento"}'
```

### 3. Observar atualização em tempo real

O monitoramento mostrará:

```
Check #1: ⏳ AGUARDANDO CANCELAMENTO...
Check #2: ⏳ AGUARDANDO CANCELAMENTO...
Check #3: ✅ TUDO CANCELADO!
```

### 4. Verificação final

```bash
# Terminal 3
node scripts/verify-cancellation.js 691f4d1f93574a269d24ddbf
```

---

## 📊 Collections Verificadas

### 1. **CONVERSATION**
- ✅ `isActive` deve ser `false`
- ✅ `boostingStatus` deve ser `'cancelled'`
- ✅ `status` deve ser `'cancelled'`
- ✅ `isFinalized` deve ser `true`

### 2. **AGREEMENT**
- ✅ `status` deve ser `'cancelled'`
- ✅ `cancelledAt` deve estar preenchido

### 3. **ACCEPTEDPROPOSAL**
- ✅ `status` deve ser `'cancelled'`
- ✅ `cancelledAt` deve estar preenchido

### 4. **BOOSTING_REQUESTS**
- ✅ `status` deve ser `'cancelled'`
- ✅ `cancelledAt` deve estar preenchido

### 5. **BOOSTINGORDER** (Bônus)
- ✅ `status` deve ser `'cancelled'`
- ✅ `cancelledAt` deve estar preenchido

---

## 🐛 Troubleshooting

### Erro: "conversationId is required"

```bash
# ❌ Errado
node scripts/verify-cancellation.js

# ✅ Correto
node scripts/verify-cancellation.js 691f4d1f93574a269d24ddbf
```

### Erro: "Conversation not found"

Verifique se o `conversationId` está correto:

```bash
# Verificar no MongoDB
db.conversations.findOne({ _id: ObjectId("691f4d1f93574a269d24ddbf") })
```

### Erro: "Erro ao conectar ao MongoDB"

Verifique a variável de ambiente `MONGODB_URI`:

```bash
# .env
MONGODB_URI=mongodb://localhost:27017/hacklote
```

### Collections não estão sendo atualizadas

1. Verifique se a transação está sendo executada:
   ```bash
   # Ver logs do backend
   tail -f logs/app.log | grep "Internal Boosting Cancel"
   ```

2. Verifique se há erros na transação:
   ```bash
   # Ver erros
   tail -f logs/error.log
   ```

3. Execute o monitoramento durante o cancelamento:
   ```bash
   node scripts/monitor-collections.js 691f4d1f93574a269d24ddbf 1
   ```

---

## 📝 Exemplo Completo

### Cenário: Cancelar boosting e verificar

```bash
# 1. Iniciar monitoramento
node scripts/monitor-collections.js 691f4d1f93574a269d24ddbf 2 &

# 2. Cancelar via API
curl -X POST http://localhost:3000/api/internal/boosting/691f4d1f93574a269d24ddbf/cancel \
  -H "Content-Type: application/json" \
  -d '{"reason":"Teste de cancelamento"}'

# 3. Aguardar atualização (2-5 segundos)
# Monitoramento mostrará: ✅ TUDO CANCELADO!

# 4. Verificação final
node scripts/verify-cancellation.js 691f4d1f93574a269d24ddbf
```

---

## 🎯 Resultado Esperado

Quando tudo funciona corretamente:

```
✅ TODAS AS 4 COLLECTIONS FORAM ATUALIZADAS CORRETAMENTE!
```

Se alguma collection não foi atualizada:

```
❌ ALGUMAS COLLECTIONS NÃO FORAM ATUALIZADAS
```

---

## 📞 Suporte

Se as collections não estão sendo atualizadas:

1. Verifique os logs do backend
2. Execute o monitoramento durante o cancelamento
3. Verifique se a transação está sendo commitada
4. Verifique se há erros silenciosos na transação

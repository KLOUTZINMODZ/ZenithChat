# Correção: Pedidos de Boosting não aparecem em "Minhas Compras/Vendas"

## 🔍 Problema Identificado

Os pedidos de boosting não estão sendo exibidos nas telas de "Minhas Compras" e "Minhas Vendas", apenas os itens do marketplace aparecem.

## 📋 Diagnóstico

### Situação Atual

O endpoint `/api/purchases/list` **JÁ ESTÁ PREPARADO** para retornar tanto pedidos de marketplace quanto pedidos de boosting:

1. ✅ **Código da API está correto** - Busca `Purchase` (marketplace) e `BoostingOrder` (boosting)
2. ✅ **Front-end está correto** - Renderiza ambos os tipos
3. ❌ **Problema**: BoostingOrders não estão sendo criados no banco de dados

### Causa Raiz

Os `BoostingOrder` são criados apenas quando há ações específicas em Agreements:
- Quando um Agreement é aceito
- Quando um Agreement é completado  
- Quando um Agreement é cancelado

**Porém**, Agreements antigos ou que não passaram por essas ações não possuem BoostingOrders correspondentes.

## 🛠️ Solução Implementada

### 1. Logs de Debug Adicionados

**Arquivo**: `src/routes/purchasesRoutes.js`

Adicionados logs em dois pontos estratégicos:

#### Log 1: Após buscar os dados
```javascript
console.log('[PURCHASES LIST DEBUG]', {
  userId: String(userId),
  type,
  statusParam,
  marketplacePurchases: purchases.length,
  boostingOrders: boostingOrders.length,
  boostingFilter: JSON.stringify(boostingFilter)
});
```

#### Log 2: Após merge e paginação
```javascript
console.log('[PURCHASES LIST RESULT]', {
  marketplaceOrders: marketplaceOrders.length,
  formattedBoostingOrders: formattedBoostingOrders.length,
  totalMerged: allOrders.length,
  paginatedCount: paginatedOrders.length,
  typesInPaginated: paginatedOrders.map(o => o.type)
});
```

### 2. Script de Diagnóstico

**Arquivo**: `scripts/checkBoostingOrders.js`

Verifica a situação atual do banco de dados:
- Conta BoostingOrders existentes
- Lista últimos pedidos
- Mostra distribuição por status
- Mostra top clientes e boosters

**Como executar**:
```bash
node scripts/checkBoostingOrders.js
```

### 3. Script de Migração (PRINCIPAL)

**Arquivo**: `scripts/migrateAgreementsToBoostingOrders.js`

Popula o banco de dados com BoostingOrders a partir dos Agreements existentes.

**Como executar**:
```bash
node scripts/migrateAgreementsToBoostingOrders.js
```

**O que o script faz**:
1. Busca todos os Agreements (pending, active, completed, cancelled)
2. Para cada Agreement:
   - Verifica se já existe um BoostingOrder
   - Se NÃO existe, cria um novo BoostingOrder
   - Se existe, atualiza com dados mais recentes
3. Exibe resumo completo da migração

## 🚀 Passos para Resolver o Problema

### Passo 1: Verificar a Situação Atual

```bash
cd "c:\Users\WDAGUtilityAccount\Desktop\SandboxShare\Nova pasta\Nova pasta\HackloteChatApi"

# Verificar quantos BoostingOrders existem
node scripts/checkBoostingOrders.js
```

### Passo 2: Executar a Migração

```bash
# Executar o script de migração
node scripts/migrateAgreementsToBoostingOrders.js
```

**Saída esperada**:
```
✅ BoostingOrders criados: X
⏭️  BoostingOrders já existentes: Y
❌ Erros: 0
📊 Total processado: Z
```

### Passo 3: Reiniciar o Servidor

```bash
# Reiniciar com PM2 (zero downtime)
npm run prod:reload

# OU restart tradicional
npm run prod:restart

# Verificar logs
npm run prod:logs
```

### Passo 4: Testar no Front-end

1. Acesse `/purchases` (Minhas Compras)
2. Acesse `/sales` (Minhas Vendas)
3. Verifique se os pedidos de boosting agora aparecem
4. Verifique os logs do servidor para ver os dados retornados

## 📊 Estrutura dos Dados

### BoostingOrder (como aparece na API)
```json
{
  "_id": "...",
  "orderNumber": "BO_123456",
  "status": "active",
  "price": 100,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "type": "boosting",
  "hasReview": false,
  "item": {
    "_id": "...",
    "title": "Boosting League of Legends",
    "image": ""
  },
  "buyer": {
    "_id": "...",
    "name": "Cliente Nome"
  },
  "seller": {
    "_id": "...",
    "name": "Booster Nome"
  },
  "boostingRequest": {
    "_id": "...",
    "game": "League of Legends",
    "currentRank": "Gold IV",
    "desiredRank": "Platinum I"
  }
}
```

### Mapeamento de Status

O status do BoostingOrder é mapeado para compatibilidade com a UI do marketplace:

| Status BoostingOrder | Status Exibido | Descrição |
|---------------------|----------------|-----------|
| `pending` | `initiated` | Aguardando início |
| `active` | `shipped` | Em andamento |
| `completed` | `completed` | Concluído |
| `cancelled` | `cancelled` | Cancelado |

## 🔄 Sincronização Automática (Futura)

Para garantir que novos Agreements sempre criem BoostingOrders, os seguintes hooks já estão implementados:

### Em agreementController.js

1. **Ao aceitar Agreement** (linha ~112):
```javascript
await BoostingOrder.createFromAgreement(agreement);
```

2. **Ao completar Agreement** (linha ~298):
```javascript
await BoostingOrder.createFromAgreement(agreement);
```

3. **Ao cancelar Agreement** (linha ~451):
```javascript
await BoostingOrder.createFromAgreement(agreement);
```

## 📝 Logs para Monitoramento

Após a migração, você pode monitorar os logs para ver se os pedidos de boosting estão sendo retornados:

```bash
# Ver logs em tempo real
pm2 logs zenith-chat-api --lines 100

# Filtrar apenas logs de purchases list
pm2 logs zenith-chat-api | grep "PURCHASES LIST"
```

**Exemplo de log esperado**:
```
[PURCHASES LIST DEBUG] {
  userId: '507f1f77bcf86cd799439011',
  type: 'purchases',
  statusParam: '',
  marketplacePurchases: 5,
  boostingOrders: 3,
  boostingFilter: '{"clientId":"507f1f77bcf86cd799439011"}'
}

[PURCHASES LIST RESULT] {
  marketplaceOrders: 5,
  formattedBoostingOrders: 3,
  totalMerged: 8,
  paginatedCount: 8,
  typesInPaginated: ['marketplace', 'marketplace', 'boosting', 'marketplace', 'boosting', 'marketplace', 'marketplace', 'boosting']
}
```

## 🎯 Verificação de Sucesso

Após executar os passos acima, você deve ver:

✅ **No banco de dados**:
- BoostingOrders criados para todos os Agreements

✅ **Nos logs do servidor**:
- `boostingOrders: X` (onde X > 0) no log DEBUG
- `formattedBoostingOrders: X` no log RESULT
- Array `typesInPaginated` contém tanto `'marketplace'` quanto `'boosting'`

✅ **No front-end**:
- Pedidos de boosting aparecem em "Minhas Compras"
- Pedidos de boosting aparecem em "Minhas Vendas"
- Badge de tipo indica "Boosting" ou "Marketplace"
- Informações do jogo (ex: League of Legends, Ouro IV → Platina I) são exibidas

## 🔧 Troubleshooting

### Problema: Script de migração falha com erro de conexão
**Solução**: Verificar se o `.env` está configurado corretamente:
```bash
# Verificar se MONGODB_URI está definido
grep MONGODB_URI .env
```

### Problema: BoostingOrders criados mas não aparecem na listagem
**Solução**: Verificar os logs do servidor. Pode ser:
1. Filtro de status muito restritivo
2. Problema de paginação (tente aumentar `limit` na query)

### Problema: Logs não aparecem
**Solução**: Os logs só aparecem quando o endpoint é chamado. Faça uma requisição ao endpoint:
```bash
# Via curl
curl -X GET "https://zenith.enrelyugi.com.br/api/purchases/list?type=purchases" \
  -H "Authorization: Bearer SEU_TOKEN"
```

## 📊 Resumo da Solução

| Item | Status | Ação Necessária |
|------|--------|-----------------|
| Código da API | ✅ Correto | Nenhuma |
| Código do Front-end | ✅ Correto | Nenhuma |
| BoostingOrders no banco | ❌ Faltando | ✅ Executar migração |
| Logs de debug | ✅ Adicionados | ✅ Monitorar após migração |
| Scripts de manutenção | ✅ Criados | ✅ Executar quando necessário |

## 🎉 Conclusão

Após executar o script de migração e reiniciar o servidor, os pedidos de boosting devem aparecer normalmente junto com os pedidos de marketplace nas telas de "Minhas Compras" e "Minhas Vendas".

O problema não estava no código, mas sim na ausência de dados (BoostingOrders) no banco de dados. A solução é executar o script de migração uma única vez para popular esses dados históricos.

---

**Prioridade**: 🔴 ALTA  
**Impacto**: Melhora significativa na experiência do usuário  
**Tempo estimado**: 5-10 minutos para executar a migração

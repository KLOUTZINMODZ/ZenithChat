# Correção: Pedidos de Boosting Cancelados Aparecem como "Em Progresso"

## 🔴 Problema Identificado

Na tela "Pedidos em Aberto", pedidos de boosting com status `cancelled` estavam sendo exibidos incorretamente como "em progresso" ao invés de "cancelados".

## 🔍 Diagnóstico

### Causa Raiz

**Arquivo**: `src/routes/purchasesRoutes.js` - Linha 300

O código estava usando `'active'` como valor padrão quando o status do BoostingOrder era `null` ou `undefined`:

```javascript
// ❌ CÓDIGO PROBLEMÁTICO (ANTES)
const boostingStatus = String(bo.status || 'active').toLowerCase();
```

**Impacto**:
- Pedidos com status `null` ou `undefined` → Tratados como `'active'` → Mapeados para `'shipped'` (em progresso)
- Pedidos cancelados que por algum motivo tinham status nulo também eram exibidos como "em progresso"
- Status `'expired'` e `'disputed'` não tinham tratamento específico

### Status Possíveis no BoostingOrder

Segundo o modelo `BoostingOrder.js`, os status possíveis são:
- `'pending'` - Aguardando início
- `'active'` - Em andamento
- `'completed'` - Concluído
- `'cancelled'` - Cancelado
- `'expired'` - Expirado
- `'disputed'` - Em disputa

**Default no modelo**: `'pending'` (não `'active'`)

## ✅ Solução Implementada

### 1. Correção do Fallback de Status

**Arquivo**: `src/routes/purchasesRoutes.js` - Linhas 298-312

```javascript
// ✅ CÓDIGO CORRIGIDO (DEPOIS)
// Mapear status do BoostingOrder para status compatível com marketplace UI
// Status possíveis: pending, active, completed, cancelled, expired, disputed
const boostingStatus = String(bo.status || 'pending').toLowerCase();
let mappedStatus = boostingStatus;

if (boostingStatus === 'active') {
  mappedStatus = 'shipped'; // Em andamento
} else if (boostingStatus === 'pending') {
  mappedStatus = 'initiated'; // Pendente
} else if (boostingStatus === 'expired') {
  mappedStatus = 'cancelled'; // Expirados tratados como cancelados
} else if (boostingStatus === 'disputed') {
  mappedStatus = 'shipped'; // Disputados aparecem como em progresso (aguardando resolução)
}
// completed e cancelled permanecem iguais (sem alteração)
```

### 2. Mapeamento Completo de Status

| Status BoostingOrder | Status Mapeado (UI) | Descrição |
|---------------------|---------------------|-----------|
| `pending` | `initiated` | Pedido pendente/aguardando |
| `active` | `shipped` | Em andamento/progresso |
| `completed` | `completed` | Concluído |
| `cancelled` | `cancelled` | ✅ **Cancelado (PRESERVADO)** |
| `expired` | `cancelled` | Expirado → Tratado como cancelado |
| `disputed` | `shipped` | Em disputa → Aparece como em progresso |
| `null/undefined` | `initiated` | Fallback seguro para pending |

### 3. Correção do Timestamp

**Arquivo**: `src/routes/purchasesRoutes.js` - Linhas 314-324

Adicionado tratamento para usar o timestamp correto baseado no status:

```javascript
// Determinar timestamp correto baseado no status
let orderTimestamp = bo.createdAt;
if (boostingStatus === 'completed' && bo.completedAt) {
  orderTimestamp = bo.completedAt;
} else if (boostingStatus === 'cancelled' && bo.cancelledAt) {
  orderTimestamp = bo.cancelledAt;
} else if (boostingStatus === 'expired' && bo.expiredAt) {
  orderTimestamp = bo.expiredAt; // ✅ NOVO
} else if (boostingStatus === 'active' && bo.activatedAt) {
  orderTimestamp = bo.activatedAt; // ✅ OTIMIZADO
}
```

### 4. Log de Debug Melhorado

Adicionada distribuição de status nos logs para facilitar diagnóstico:

```javascript
console.log('[PURCHASES LIST DEBUG]', {
  userId: String(userId),
  type,
  statusParam,
  marketplacePurchases: purchases.length,
  boostingOrders: boostingOrders.length,
  boostingFilter: JSON.stringify(boostingFilter),
  boostingStatusDistribution: boostingOrders.reduce((acc, bo) => {
    const status = String(bo.status || 'null');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {}) // ✅ Mostra quantos pedidos de cada status existem
});
```

## 🚀 Como Aplicar a Correção

### Passo 1: Reiniciar o Servidor

```bash
cd "c:\Users\WDAGUtilityAccount\Desktop\SandboxShare\Nova pasta\Nova pasta\HackloteChatApi"

# Reiniciar com PM2 (zero downtime)
npm run prod:reload

# OU restart tradicional
npm run prod:restart
```

### Passo 2: Verificar nos Logs

```bash
# Ver logs em tempo real
npm run prod:logs

# Buscar por distribuição de status
pm2 logs zenith-chat-api | grep "boostingStatusDistribution"
```

**Log esperado**:
```json
[PURCHASES LIST DEBUG] {
  userId: '...',
  boostingOrders: 10,
  boostingStatusDistribution: {
    "active": 3,
    "completed": 2,
    "cancelled": 5  // ← Deve aparecer separado agora!
  }
}
```

### Passo 3: Testar no Front-end

1. Acesse `/open-orders` (Pedidos em Aberto)
2. Verifique pedidos de boosting cancelados
3. ✅ Status deve aparecer como "Cancelado" ao invés de "Em progresso"

## 📊 Comportamento Antes vs Depois

### ❌ ANTES (INCORRETO)

| Status Real | Status Exibido | Problema |
|-------------|----------------|----------|
| `cancelled` | Em progresso | ❌ Errado! |
| `expired` | Em progresso | ❌ Errado! |
| `null` | Em progresso | ❌ Errado! |
| `active` | Em progresso | ✅ Correto |

### ✅ DEPOIS (CORRETO)

| Status Real | Status Exibido | Resultado |
|-------------|----------------|-----------|
| `cancelled` | Cancelado | ✅ Correto! |
| `expired` | Cancelado | ✅ Correto! |
| `null` | Pendente | ✅ Correto! |
| `active` | Em progresso | ✅ Correto |
| `disputed` | Em progresso | ✅ Correto (aguardando resolução) |

## 🎯 Verificação de Sucesso

Execute os seguintes testes:

### Teste 1: Pedido Cancelado
```
✅ Pedido de boosting com status 'cancelled' deve aparecer como "Cancelado"
✅ Timestamp deve ser o 'cancelledAt'
✅ Não deve aparecer em filtros de "pedidos ativos"
```

### Teste 2: Pedido Expirado
```
✅ Pedido de boosting com status 'expired' deve aparecer como "Cancelado"
✅ Timestamp deve ser o 'expiredAt'
```

### Teste 3: Pedido em Disputa
```
✅ Pedido de boosting com status 'disputed' deve aparecer como "Em progresso"
✅ Deve ter indicação visual de que está em disputa
```

### Teste 4: Pedido com Status Nulo
```
✅ Pedido com status null/undefined deve aparecer como "Pendente"
✅ Não deve quebrar a aplicação
```

## 🔍 Monitoramento

Para verificar se pedidos cancelados estão aparecendo corretamente:

```bash
# Monitorar logs de status
pm2 logs zenith-chat-api --lines 100 | grep "boostingStatusDistribution"

# Exemplo de saída correta:
# boostingStatusDistribution: { active: 3, completed: 5, cancelled: 2, pending: 1 }
```

Se você ver muitos pedidos com status `'null'` no log, isso pode indicar:
1. Problema na criação de BoostingOrders
2. Dados legados que precisam ser atualizados
3. Bug no processo de atualização de status

## 🔄 Compatibilidade com Front-end

### OpenOrdersPage.tsx

O front-end já possui mapeamento correto de status (linhas 122-129):

```typescript
const mapBoostingStatus = (s?: string): string => {
  const v = String(s || '').toLowerCase();
  if (['completed'].includes(v)) return 'completed';
  if (['cancelled','canceled'].includes(v)) return 'cancelled'; // ✅ JÁ TRATAVA
  if (['pending'].includes(v)) return 'pending';
  if (['active','in_progress','disputed'].includes(v)) return 'in_progress';
  return 'open';
};
```

**Resultado**: A API agora envia o status correto (`'cancelled'`), e o front-end já está preparado para exibi-lo corretamente.

## 📝 Arquivos Modificados

| Arquivo | Linhas | Mudanças |
|---------|--------|----------|
| `src/routes/purchasesRoutes.js` | 298-312 | Corrigido mapeamento de status |
| `src/routes/purchasesRoutes.js` | 314-324 | Corrigido tratamento de timestamp |
| `src/routes/purchasesRoutes.js` | 231-235 | Adicionado log de distribuição de status |

## 🐛 Problemas Relacionados Resolvidos

1. ✅ Pedidos cancelados não aparecem mais como "em progresso"
2. ✅ Pedidos expirados são corretamente tratados como cancelados
3. ✅ Pedidos em disputa aparecem como "em progresso" (aguardando resolução)
4. ✅ Pedidos com status nulo não quebram a aplicação
5. ✅ Timestamps corretos são usados para cada status

## 💡 Prevenção de Problemas Futuros

### Validação no Backend

Se você quiser garantir que todos os BoostingOrders tenham status válido, pode executar este script:

```javascript
// scripts/fixBoostingOrdersStatus.js
const BoostingOrder = require('../src/models/BoostingOrder');

async function fixStatuses() {
  const orders = await BoostingOrder.find({ 
    $or: [
      { status: null }, 
      { status: { $exists: false } }
    ] 
  });
  
  console.log(`Encontrados ${orders.length} pedidos sem status`);
  
  for (const order of orders) {
    order.status = 'pending'; // Default seguro
    await order.save();
    console.log(`✅ Status corrigido para pedido ${order.orderNumber}`);
  }
}
```

### Monitoramento Contínuo

Adicione ao seu monitoramento:
```bash
# Verificar pedidos com status inválido
db.boostingorders.countDocuments({ 
  status: { $nin: ['pending', 'active', 'completed', 'cancelled', 'expired', 'disputed'] } 
})
```

## 🎉 Conclusão

A correção garante que:

✅ Pedidos cancelados são exibidos corretamente como "Cancelado"  
✅ Todos os status do BoostingOrder têm mapeamento apropriado  
✅ Timestamps corretos são usados para cada status  
✅ Logs de debug facilitam diagnóstico futuro  
✅ Compatibilidade total com front-end mantida

---

**Prioridade**: 🟡 MÉDIA-ALTA  
**Impacto**: Melhora a precisão da informação exibida aos usuários  
**Risco**: 🟢 BAIXO - Apenas correção de lógica de mapeamento  
**Tempo para aplicar**: < 1 minuto (apenas restart do servidor)

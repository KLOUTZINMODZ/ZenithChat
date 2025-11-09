# Correção de Status de Boostings Cancelados

## Problema Identificado
Os pedidos de boosting com status `cancelled` não estavam sendo exibidos corretamente na tela de "Pedidos em Aberto". Apareciam como "em progresso" ou não apareciam na lista.

## Causa Raiz
1. **Filtro Restritivo**: O endpoint `/api/purchases/list` estava filtrando apenas agreements com `status: 'completed'`, excluindo todos os outros status (cancelled, active, pending).
2. **Status Hardcoded**: O status estava sendo hardcoded como `'completed'` ao invés de usar o status real do agreement.
3. **Timestamp Incorreto**: Estava usando `completedAt` para ordenação, que não existe em agreements cancelados.

## Correções Aplicadas

### 1. Filtro de Status Dinâmico (linhas 196-227)
```javascript
// ANTES: Apenas completed
const boostingFilter = { status: 'completed' };

// DEPOIS: Todos os status, com suporte a filtros
const boostingFilter = {};

if (statusParam) {
  const statuses = statusParam.split(',').map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
  const agreementStatuses = [];
  if (statuses.includes('completed')) agreementStatuses.push('completed');
  if (statuses.includes('cancelled')) agreementStatuses.push('cancelled');
  if (statuses.includes('initiated') || statuses.includes('escrow_reserved') || statuses.includes('shipped')) {
    agreementStatuses.push('active', 'pending');
  }
  if (agreementStatuses.length > 0) {
    boostingFilter.status = { $in: agreementStatuses };
  }
}
```

### 2. Mapeamento de Status (linhas 327-340)
```javascript
// Mapear status do agreement para status compatível com marketplace
const agreementStatus = String(a.status || 'active').toLowerCase();
let mappedStatus = agreementStatus;

if (agreementStatus === 'active') {
  mappedStatus = 'shipped'; // Em andamento
} else if (agreementStatus === 'pending') {
  mappedStatus = 'initiated'; // Pendente
} else if (agreementStatus === 'completed') {
  mappedStatus = 'completed';
} else if (agreementStatus === 'cancelled') {
  mappedStatus = 'cancelled'; // Cancelado
}
```

### 3. Timestamp Correto (linhas 342-350)
```javascript
// Determinar timestamp correto baseado no status
let orderTimestamp = a.createdAt;
if (agreementStatus === 'completed' && a.completedAt) {
  orderTimestamp = a.completedAt;
} else if (agreementStatus === 'cancelled' && a.cancelledAt) {
  orderTimestamp = a.cancelledAt;
} else if (a.activatedAt) {
  orderTimestamp = a.activatedAt;
}
```

## Mapeamento de Status

### Agreement → Marketplace UI
| Agreement Status | Marketplace Status | Descrição |
|-----------------|-------------------|-----------|
| `pending` | `initiated` | Aguardando início |
| `active` | `shipped` | Em andamento |
| `completed` | `completed` | Concluído |
| `cancelled` | `cancelled` | Cancelado |

## Estrutura de Dados Retornados

### Boosting Order Format
```javascript
{
  _id: String,
  orderNumber: String, // Agreement ID ou últimos 8 chars
  status: String, // Status mapeado (initiated, shipped, completed, cancelled)
  price: Number,
  feePercent: 0, // Boostings não têm taxa
  feeAmount: 0,
  sellerReceives: Number, // Mesmo valor que price
  createdAt: Date, // Timestamp correto baseado no status
  type: 'boosting',
  hasReview: Boolean,
  item: {
    _id: String, // ID do BoostingRequest
    title: String,
    image: ''
  },
  buyer: { _id, name },
  seller: { _id, name },
  boostingRequest: {
    _id: String,
    game: String,
    currentRank: String,
    desiredRank: String
  }
}
```

## Compatibilidade

### APIs Afetadas
- ✅ `HackloteChatApi/src/routes/purchasesRoutes.js`
- ✅ Status de agreements (cancelled, completed, active, pending)
- ✅ Frontend: SalesPage, PurchasesPage, BoostingDetailPage

### Endpoints Testados
- `GET /api/purchases/list?type=sales` - Lista vendas (marketplace + boosting)
- `GET /api/purchases/list?type=purchases` - Lista compras (marketplace + boosting)
- `GET /api/purchases/list?status=cancelled` - Filtra apenas cancelados
- `GET /api/agreements/:id` - Detalhes do boosting

## Testes Recomendados

1. **Listar boostings cancelados**:
```bash
GET /api/purchases/list?type=sales&status=cancelled
```

2. **Listar todos os boostings**:
```bash
GET /api/purchases/list?type=sales
```

3. **Visualizar boosting cancelado**:
```bash
GET /api/agreements/:agreementId
```

## Próximos Passos

1. ✅ Corrigir backend (purchasesRoutes.js)
2. ⏳ Testar exibição no frontend
3. ⏳ Verificar badges de status na UI
4. ⏳ Validar navegação para `/boostings/:id`

## Notas de Compatibilidade

- **Backward Compatible**: Sim - agreements antigos continuam funcionando
- **Database Migration**: Não necessária
- **Frontend Changes**: Mínimas - apenas badges de status
- **API Version**: Compatível com versão atual

## Status da Correção
- [x] Identificar problema
- [x] Corrigir filtro de status
- [x] Mapear status corretamente
- [x] Usar timestamp adequado
- [x] Documentar mudanças
- [ ] Testar em produção

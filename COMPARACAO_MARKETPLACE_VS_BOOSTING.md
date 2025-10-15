# 📊 Comparação: Marketplace vs Boosting

**Data:** 15/10/2025  
**Objetivo:** Garantir que o fluxo de boosting é idêntico ao marketplace

---

## 🔄 Fluxo Marketplace (purchasesRoutes.js)

### **Confirmação de Entrega (Comprador confirma):**

```javascript
// 1. CREDITAR VENDEDOR (95%)
const seller = await User.findById(purchase.sellerId).session(session);
const before = round2(seller.walletBalance || 0);
const after = round2(before + Number(purchase.sellerReceives));
seller.walletBalance = after;
await seller.save({ session });

// 2. WALLET LEDGER (Vendedor - Crédito)
const releaseCreated = await WalletLedger.create([{
  userId: purchase.sellerId,
  txId: null,
  direction: 'credit',
  reason: 'purchase_release',
  amount: Number(purchase.sellerReceives),
  operationId: `purchase_release:${purchase._id.toString()}`,
  balanceBefore: before,
  balanceAfter: after,
  metadata: { 
    source: 'purchase', 
    purchaseId: purchase._id.toString(), 
    itemId: purchase.itemId, 
    price: Number(purchase.price), 
    feeAmount: Number(purchase.feeAmount || 0), 
    sellerReceives: Number(purchase.sellerReceives) 
  }
}], { session });

// 3. MEDIATOR LOG (Release)
await Mediator.updateOne(
  { operationId: `release:${purchase._id.toString()}` },
  {
    $setOnInsert: {
      eventType: 'release',
      amount: Number(purchase.sellerReceives),
      currency: 'BRL',
      operationId: `release:${purchase._id.toString()}`,
      source: 'ZenithChatApi',
      occurredAt: new Date(),
      reference: {
        purchaseId: purchase._id,
        orderId: null,
        walletLedgerId: releaseCreated[0]?._id || null,
        transactionId: null,
        asaasTransferId: null
      },
      metadata: { 
        price: Number(purchase.price), 
        feeAmount: Number(purchase.feeAmount || 0), 
        sellerReceives: Number(purchase.sellerReceives) 
      },
      description: 'Liberação de escrow ao vendedor'
    }
  },
  { upsert: true, session }
);

// 4. TENTAR CREDITAR MEDIADOR (5%)
try {
  const feeAmount = Number(purchase.feeAmount || 0);
  if (feeAmount > 0) {
    let mediatorUser = null;
    const envId = process.env.MEDIATOR_USER_ID;
    const envEmail = process.env.MEDIATOR_EMAIL;
    
    // Tentar por ID
    if (envId) {
      try { mediatorUser = await User.findById(envId).session(session); } catch (_) {}
    }
    
    // Tentar por email
    if (!mediatorUser && envEmail) {
      try { mediatorUser = await User.findOne({ email: envEmail }).session(session); } catch (_) {}
    }
    
    // SE ENCONTROU mediador, creditar
    if (mediatorUser) {
      const medBefore = round2(mediatorUser.walletBalance || 0);
      const medAfter = round2(medBefore + feeAmount);
      mediatorUser.walletBalance = medAfter;
      await mediatorUser.save({ session });
      
      // WALLET LEDGER (Mediador - Crédito)
      const created = await WalletLedger.create([{
        userId: mediatorUser._id,
        txId: null,
        direction: 'credit',
        reason: 'purchase_fee',
        amount: feeAmount,
        operationId: `purchase_fee:${purchase._id.toString()}`,
        balanceBefore: medBefore,
        balanceAfter: medAfter,
        metadata: { 
          source: 'purchase', 
          purchaseId: purchase._id.toString(), 
          itemId: purchase.itemId, 
          sellerId: purchase.sellerId, 
          price: Number(purchase.price), 
          feeAmount: feeAmount, 
          sellerReceives: Number(purchase.sellerReceives) 
        }
      }], { session });
      
      // MEDIATOR LOG (Fee)
      await Mediator.create([{
        eventType: 'fee',
        amount: feeAmount,
        currency: 'BRL',
        operationId: `purchase_fee:${purchase._id.toString()}`,
        source: 'ZenithChatApi',
        occurredAt: new Date(),
        reference: {
          purchaseId: purchase._id,
          walletLedgerId: created[0]?._id || null,
          orderId: null,
          transactionId: null,
          asaasTransferId: null
        },
        metadata: { 
          price: Number(purchase.price), 
          feeAmount: feeAmount, 
          sellerReceives: Number(purchase.sellerReceives), 
          sellerId: purchase.sellerId 
        },
        description: 'Taxa de mediação (5%) creditada ao mediador'
      }], { session });
    } else {
      // SE NÃO ENCONTROU, apenas avisar (não cria nada)
      logger?.warn?.('[PURCHASES] Mediator user not found; fee not credited');
    }
  }
} catch (e) {
  logger?.error?.('[PURCHASES] Failed to credit mediator fee', { error: e?.message });
}

// 5. WALLET LEDGER (Comprador - Settlement com amount: 0)
const buyer = await User.findById(purchase.buyerId).session(session);
const buyerBefore = round2(buyer?.walletBalance || 0);
await WalletLedger.create([{
  userId: purchase.buyerId,
  txId: null,
  direction: 'debit',
  reason: 'purchase_settle',
  amount: 0,
  operationId: `purchase_settle:${purchase._id.toString()}`,
  balanceBefore: buyerBefore,
  balanceAfter: buyerBefore,
  metadata: { 
    source: 'purchase', 
    purchaseId: purchase._id.toString(), 
    itemId: purchase.itemId 
  }
}], { session });

// 6. ATUALIZAR STATUS
purchase.status = 'completed';
purchase.deliveredAt = new Date();
```

---

## 🔄 Fluxo Boosting (boostingChatController.js)

### **Confirmação de Entrega (Cliente confirma):**

```javascript
// 1. VERIFICAR ESCROW (Específico do boosting)
const existingEscrow = await WalletLedger.findOne({
  userId: clientUserId,
  reason: 'boosting_escrow',
  'metadata.agreementId': agreement?._id?.toString()
}).session(session);

if (existingEscrow) {
  // Cliente já foi debitado - criar ledger com amount: 0
  await WalletLedger.create([{
    userId: clientUserId,
    txId: null,
    direction: 'debit',
    reason: 'boosting_escrow_release',
    amount: 0,
    operationId: `boosting_escrow_release:${agreement._id}`,
    balanceBefore: clientBalanceBefore,
    balanceAfter: clientBalanceAfter,
    metadata: { /* ... */ }
  }], { session });
} else {
  // Fluxo legado - debitar agora
  // (código de débito)
}

// 2. CREDITAR BOOSTER (95%)
const boosterUser = await User.findById(boosterUserId).session(session);
const boosterBalanceBefore = round2(boosterUser.walletBalance || 0);
const boosterBalanceAfter = round2(boosterBalanceBefore + boosterReceives);
boosterUser.walletBalance = boosterBalanceAfter;
await boosterUser.save({ session });

// 3. WALLET LEDGER (Booster - Crédito)
const boosterLedger = await WalletLedger.create([{
  userId: boosterUserId,
  txId: null,
  direction: 'credit',
  reason: 'boosting_release',
  amount: boosterReceives,
  operationId: `boosting_release:${agreement._id}`,
  balanceBefore: boosterBalanceBefore,
  balanceAfter: boosterBalanceAfter,
  metadata: {
    source: 'boosting',
    agreementId: agreement._id?.toString(),
    conversationId: conversationId,
    clientId: clientUserId?.toString(),
    price: Number(price),
    feeAmount: Number(feeAmount),
    boosterReceives: Number(boosterReceives),
    feePercent: 0.05,
    type: 'boosting_service'
  }
}], { session });

// 4. MEDIATOR LOG (Release)
await Mediator.create([{
  eventType: 'release',
  amount: boosterReceives,
  currency: 'BRL',
  operationId: `boosting_release:${agreement._id}`,
  source: 'ZenithChatApi',
  occurredAt: new Date(),
  reference: {
    agreementId: agreement._id,
    conversationId: conversationId,
    walletLedgerId: boosterLedger[0]?._id || null,
    transactionId: null,
    asaasTransferId: null
  },
  metadata: {
    price: Number(price),
    feeAmount: Number(feeAmount),
    boosterReceives: Number(boosterReceives),
    clientId: clientUserId?.toString(),
    boosterId: boosterUserId?.toString(),
    feePercent: 0.05,
    serviceType: 'boosting'
  },
  description: 'Liberação de pagamento ao booster'
}], { session });

// 5. REGISTRAR TAXA MEDIADOR (5%) - APENAS AUDITORIA
try {
  if (feeAmount > 0) {
    // MEDIATOR LOG (Fee) - SEM creditar usuário
    await Mediator.create([{
      eventType: 'fee',
      amount: feeAmount,
      currency: 'BRL',
      operationId: `boosting_fee:${agreement._id}`,
      source: 'ZenithChatApi',
      occurredAt: new Date(),
      reference: {
        agreementId: agreement._id,
        conversationId: conversationId,
        walletLedgerId: null, // ❌ NULL (não há WalletLedger do mediador)
        transactionId: null,
        asaasTransferId: null
      },
      metadata: { 
        price: Number(price), 
        feeAmount: feeAmount, 
        boosterReceives: Number(boosterReceives), 
        boosterId: boosterUserId?.toString(),
        clientId: clientUserId?.toString()
      },
      description: 'Taxa de mediação (5%) - Boosting'
    }], { session });
  }
} catch (e) {
  console.error('[BOOSTING] Erro ao registrar taxa do mediador:', e?.message);
}

// 6. ATUALIZAR STATUS
agreement.status = 'completed';
agreement.completedAt = new Date();
```

---

## ❌ DIFERENÇAS ENCONTRADAS

### **1. Creditar Usuário Mediador:**

| Marketplace | Boosting | Status |
|-------------|----------|--------|
| ✅ Tenta creditar usuário mediador | ❌ NÃO credita usuário | ❌ DIFERENTE |
| ✅ Cria WalletLedger do mediador (se encontrado) | ❌ NÃO cria WalletLedger | ❌ DIFERENTE |
| ✅ SEMPRE cria Mediator log (fee) | ✅ SEMPRE cria Mediator log (fee) | ✅ IGUAL |

---

### **2. WalletLedger do Comprador/Cliente:**

| Marketplace | Boosting | Status |
|-------------|----------|--------|
| ✅ Cria `purchase_settle` (amount: 0) | ❌ NÃO cria `boosting_settle` | ❌ FALTANDO |

---

### **3. Mediator.updateOne vs Mediator.create (Release):**

| Marketplace | Boosting | Status |
|-------------|----------|--------|
| ✅ Usa `updateOne` com `upsert` (idempotente) | ❌ Usa `create` (pode duplicar) | ⚠️ POTENCIAL BUG |

---

## ✅ SEMELHANÇAS

| Aspecto | Marketplace | Boosting | Status |
|---------|-------------|----------|--------|
| **Creditar fornecedor** | ✅ Sim (seller) | ✅ Sim (booster) | ✅ IGUAL |
| **WalletLedger fornecedor** | ✅ Sim | ✅ Sim | ✅ IGUAL |
| **Mediator log (release)** | ✅ Sim | ✅ Sim | ✅ IGUAL |
| **Mediator log (fee)** | ✅ Sim | ✅ Sim | ✅ IGUAL |
| **Transação atômica** | ✅ runTx | ✅ runTx | ✅ IGUAL |

---

## 🔧 CORREÇÕES NECESSÁRIAS

### **1. Adicionar Settlement do Cliente (amount: 0)**

O marketplace cria um `purchase_settle` com amount: 0 para o comprador aparecer no histórico.

**Boosting deveria fazer o mesmo:**

```javascript
// Após registrar taxa do mediador, adicionar:
try {
  const client = await User.findById(clientUserId).session(session);
  const clientBefore = round2(client?.walletBalance || 0);
  await WalletLedger.create([{
    userId: clientUserId,
    txId: null,
    direction: 'debit',
    reason: 'boosting_settle',
    amount: 0,
    operationId: `boosting_settle:${agreement._id}`,
    balanceBefore: clientBefore,
    balanceAfter: clientBefore,
    metadata: { 
      source: 'boosting', 
      agreementId: agreement._id?.toString(),
      conversationId: conversationId
    }
  }], { session });
} catch (_) {}
```

---

### **2. Usar updateOne (Idempotente) para Mediator Release**

O marketplace usa `updateOne` com `upsert` para evitar duplicatas.

**Mudar de:**
```javascript
await Mediator.create([{ ... }])
```

**Para:**
```javascript
await Mediator.updateOne(
  { operationId: `boosting_release:${agreement._id}` },
  {
    $setOnInsert: {
      eventType: 'release',
      // ... resto dos campos
    }
  },
  { upsert: true, session }
);
```

---

### **3. Decidir sobre Usuário Mediador**

**Opção A: Seguir marketplace (tentar creditar usuário)**
```javascript
// Copiar exatamente o código do marketplace
let mediatorUser = null;
if (envId) { ... }
if (!mediatorUser && envEmail) { ... }
if (mediatorUser) {
  // Creditar e criar WalletLedger
}
// SEMPRE criar Mediator log (dentro ou fora do if)
```

**Opção B: Boosting sem usuário mediador (atual)**
```javascript
// Apenas criar Mediator log (sem creditar usuário)
await Mediator.create([{ eventType: 'fee', ... }])
```

**❓ Pergunta: O marketplace precisa do usuário mediador ou também funciona sem?**

---

## 📊 Resumo das Diferenças

| # | Aspecto | Marketplace | Boosting | Ação |
|---|---------|-------------|----------|------|
| 1 | Creditar usuário mediador | ✅ Tenta | ❌ Não | Decidir |
| 2 | WalletLedger mediador | ✅ Se encontrado | ❌ Não | Decidir |
| 3 | Settlement comprador | ✅ Sim (amount: 0) | ❌ Não | ✅ Adicionar |
| 4 | Mediator.release | ✅ updateOne (idempotente) | ❌ create | ✅ Mudar |
| 5 | Mediator.fee | ✅ create | ✅ create | ✅ Igual |

---

## ✅ CHECKLIST DE ALINHAMENTO

Para o boosting ficar **100% idêntico** ao marketplace:

- [ ] Adicionar `boosting_settle` (cliente, amount: 0)
- [ ] Mudar `Mediator.create` → `Mediator.updateOne` (release)
- [ ] Decidir: creditar usuário mediador ou não?
  - [ ] Se SIM: copiar código do marketplace
  - [ ] Se NÃO: remover do marketplace também

---

**Status:** ⚠️ **DIFERENÇAS IDENTIFICADAS**

**Próxima ação:** Implementar correções para alinhar 100% com marketplace


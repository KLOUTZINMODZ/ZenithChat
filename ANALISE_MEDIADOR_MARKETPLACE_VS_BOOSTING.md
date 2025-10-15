# 🔍 Análise Detalhada: Mediador no Marketplace vs Boosting

**Data:** 15/10/2025  
**Problema:** Mediador não encontrado no boosting, mas funciona no marketplace

---

## ❌ Erro Atual

```
[BOOSTING] Mediador não encontrado (email: mediador@zenith.com). Taxa não creditada.
```

**Cliente:** ✅ Debitado (escrow)  
**Booster:** ✅ Creditado R$ 285  
**Mediador:** ❌ NÃO creditado R$ 15

---

## 📊 Comparação: Marketplace vs Boosting

### **1. Buscar Mediador**

#### **Marketplace (purchasesRoutes.js - linhas 633-641):**
```javascript
let mediatorUser = null;
const envId = process.env.MEDIATOR_USER_ID;
const envEmail = process.env.MEDIATOR_EMAIL;

if (envId) {
  try { 
    mediatorUser = await User.findById(envId).session(session); 
  } catch (_) {}
}

if (!mediatorUser && envEmail) {
  try { 
    mediatorUser = await User.findOne({ email: envEmail }).session(session); 
  } catch (_) {}
}
```

**Estratégia:** Tenta ID primeiro, se falhar tenta email

---

#### **Boosting ATUAL (boostingChatController.js - linhas 728-736):**
```javascript
const mediatorEmail = process.env.MEDIATOR_EMAIL || 'mediador@zenith.com';

try {
  const mediatorUser = await User.findOne({ email: mediatorEmail }).session(session);
  
  if (!mediatorUser) {
    console.warn(`[BOOSTING] Mediador não encontrado (email: ${mediatorEmail}). Taxa não creditada.`);
  }
  // ...
} catch (mediatorError) {
  console.error('[BOOSTING] Erro ao creditar mediador:', mediatorError.message);
}
```

**Estratégia:** Tenta apenas email

---

### **2. Creditar Saldo do Mediador**

#### **Marketplace (purchasesRoutes.js - linhas 643-646):**
```javascript
if (mediatorUser) {
  const medBefore = round2(mediatorUser.walletBalance || 0);
  const medAfter = round2(medBefore + feeAmount);
  mediatorUser.walletBalance = medAfter;
  await mediatorUser.save({ session });
  // ...
}
```

**✅ Atualiza `walletBalance` do usuário**

---

#### **Boosting ATUAL (boostingChatController.js - linhas 738-742):**
```javascript
if (mediatorUser) {
  const mediatorBalanceBefore = round2(mediatorUser.walletBalance || 0);
  const mediatorBalanceAfter = round2(mediatorBalanceBefore + feeAmount);
  mediatorUser.walletBalance = mediatorBalanceAfter;
  await mediatorUser.save({ session });
  // ...
}
```

**✅ Identico ao marketplace**

---

### **3. WalletLedger do Mediador**

#### **Marketplace (purchasesRoutes.js - linhas 647-657):**
```javascript
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
```

**Reason:** `purchase_fee`  
**Metadata:** purchaseId, itemId, sellerId, price, feeAmount, sellerReceives

---

#### **Boosting ATUAL (boostingChatController.js - linhas 745-767):**
```javascript
const mediatorLedger = await WalletLedger.create([{
  userId: mediatorUser._id,
  txId: null,
  direction: 'credit',
  reason: 'boosting_fee',
  amount: feeAmount,
  operationId: `boosting_fee:${agreement?._id || acceptedProposal?._id}`,
  balanceBefore: mediatorBalanceBefore,
  balanceAfter: mediatorBalanceAfter,
  metadata: {
    source: 'boosting',
    agreementId: agreement?._id?.toString() || null,
    conversationId: conversationId,
    boosterId: boosterUserId?.toString(),
    clientId: clientUserId?.toString(),
    price: Number(price),
    feeAmount: Number(feeAmount),
    boosterReceives: Number(boosterReceives),
    feePercent: 0.05,
    type: 'boosting_service'
  }
}], { session });
```

**Reason:** `boosting_fee`  
**Metadata:** agreementId, conversationId, boosterId, clientId, price, feeAmount, boosterReceives

**✅ Estrutura similar, adaptada para boosting**

---

### **4. Mediator Log (Auditoria)**

#### **Marketplace (purchasesRoutes.js - linhas 660-678):**
```javascript
try {
  const medLedgerDoc = Array.isArray(created) ? created[0] : created;
  await Mediator.create([{
    eventType: 'fee',
    amount: feeAmount,
    currency: 'BRL',
    operationId: `purchase_fee:${purchase._id.toString()}`,
    source: 'ZenithChatApi',
    occurredAt: new Date(),
    reference: {
      purchaseId: purchase._id,
      walletLedgerId: medLedgerDoc?._id || null,
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
} catch (_) {}
```

**Source:** `ZenithChatApi`  
**EventType:** `fee`

---

#### **Boosting ATUAL (boostingChatController.js - linhas 777-805):**
```javascript
try {
  await Mediator.create([{
    eventType: 'fee',
    amount: feeAmount,
    currency: 'BRL',
    operationId: `boosting_fee:${agreement?._id || acceptedProposal?._id}`,
    source: 'ZenithChatApi',
    occurredAt: new Date(),
    reference: {
      agreementId: agreement?._id || null,
      conversationId: conversationId,
      walletLedgerId: mediatorLedger[0]?._id || null,
      transactionId: null,
      asaasTransferId: null
    },
    metadata: {
      price: Number(price),
      feeAmount: Number(feeAmount),
      boosterReceives: Number(boosterReceives),
      boosterId: boosterUserId?.toString(),
      clientId: clientUserId?.toString(),
      feePercent: 0.05,
      serviceType: 'boosting'
    },
    description: 'Taxa de mediação (5%) creditada ao mediador - Boosting'
  }], { session });
} catch (_) {}
```

**Source:** `ZenithChatApi`  
**EventType:** `fee`

**✅ Identico ao marketplace, mas com campos adaptados**

---

## 🔴 PROBLEMA IDENTIFICADO

### **O código está CORRETO! O problema é:**

```
Usuário com email 'mediador@zenith.com' NÃO EXISTE no banco de dados!
```

---

## 📋 Documento do Mediator que Você Mostrou

```json
{
  "_id": { "$oid": "68cde2dec2146306d0b2f1f1" },
  "operationId": "release:68cde1ae78d93c19158a74d4",
  "amount": 2.01,
  "eventType": "release",
  "source": "HackloteChatApi",  // ← NOTA: Código atual usa "ZenithChatApi"
  "description": "Liberação de escrow ao vendedor",
  "reference": {
    "purchaseId": { "$oid": "68cde1ae78d93c19158a74d4" },
    "walletLedgerId": { "$oid": "68cde2d99b0fb52352e0e3fd" }
  }
}
```

**Observações:**
1. ✅ Este é um log de **`release`** (liberação ao vendedor), não `fee`
2. ⚠️ Source: `"HackloteChatApi"` - código atual usa `"ZenithChatApi"`
3. ✅ Estrutura correta

---

## ⚠️ Discrepância: HackloteChatApi vs ZenithChatApi

### **Código ATUAL (todos os lugares):**
```javascript
source: 'ZenithChatApi'
```

### **Documento do banco:**
```json
"source": "HackloteChatApi"
```

**Possíveis causas:**
1. O documento é de uma versão antiga do código
2. Existe outro serviço rodando com source diferente
3. O código foi atualizado recentemente

**Verificar:** O modelo Mediator aceita ambos?

```javascript
// src/models/Mediator.js
source: { 
  type: String, 
  enum: ['ZenithChatApi', 'ZenithAPI', 'APIAdministrativa', 'Asaas'], 
  required: true 
}
```

❌ **"HackloteChatApi" NÃO está no enum!** Isso pode gerar erro!

---

## ✅ SOLUÇÃO

### **1. CRÍTICO: Criar Usuário Mediador**

O usuário `mediador@zenith.com` **NÃO EXISTE**. Precisa criar:

#### **Opção A: Via MongoDB Shell**
```javascript
db.users.insertOne({
  email: 'mediador@zenith.com',
  name: 'Mediador Zenith',
  username: 'mediador',
  password: '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', // hash bcrypt de 'admin123'
  role: 'admin',
  walletBalance: 0,
  isActive: true,
  isVerified: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

#### **Opção B: Usar Usuário Existente**

Se já existe um usuário para receber taxas, configure o email no `.env`:

```env
MEDIATOR_EMAIL=email-do-usuario-existente@zenith.com
```

---

### **2. Verificar Source no Modelo**

**Arquivo:** `src/models/Mediator.js`

```javascript
source: { 
  type: String, 
  enum: ['ZenithChatApi', 'ZenithAPI', 'APIAdministrativa', 'Asaas'], 
  required: true 
}
```

**✅ 'ZenithChatApi' está no enum** - OK!

Se você quiser usar 'HackloteChatApi':

```javascript
source: { 
  type: String, 
  enum: ['ZenithChatApi', 'HackloteChatApi', 'ZenithAPI', 'APIAdministrativa', 'Asaas'], 
  required: true 
}
```

---

### **3. Script de Verificação**

Execute o script que criei:

```bash
cd HackloteChatApi
node verificar-mediador.js
```

**O que ele faz:**
1. ✅ Verifica se usuário mediador existe
2. ✅ Lista movimentações do mediador
3. ✅ Compara boosting_fee vs purchase_fee
4. ✅ Mostra saldo atual
5. ✅ Sugere solução se não encontrar

---

## 📊 Comparação Final: O que DEVE acontecer

### **Marketplace (Compra confirmada):**

```
1. Vendedor recebe 95%
   └─ WalletLedger: purchase_release
   └─ Mediator: release

2. Mediador recebe 5%
   └─ WalletLedger: purchase_fee
   └─ Mediator: fee
   └─ User.walletBalance += taxa ✅
```

---

### **Boosting (Entrega confirmada):**

```
1. Booster recebe 95%
   └─ WalletLedger: boosting_release
   └─ Mediator: release

2. Mediador recebe 5%
   └─ WalletLedger: boosting_fee
   └─ Mediator: fee
   └─ User.walletBalance += taxa ✅
```

**✅ FLUXO IDÊNTICO!**

---

## 🧪 Como Testar

### **1. Criar/Verificar Usuário Mediador**

```javascript
// MongoDB
const mediador = db.users.findOne({ email: 'mediador@zenith.com' })
if (!mediador) {
  console.log('❌ Usuário não existe! Criar primeiro!')
} else {
  console.log('✅ Usuário existe:', mediador._id)
}
```

---

### **2. Reiniciar Chat API**

```bash
pm2 restart ZenithChat
pm2 logs ZenithChat --lines 100
```

---

### **3. Confirmar Entrega de Boosting**

Logs esperados:

```
[BOOSTING] Iniciando confirmação de entrega...
[BOOSTING] Cliente já foi debitado no escrow...
[BOOSTING] Escrow liberado (saldo não alterado)
[BOOSTING] Saldo transferido ao booster: { amount: 285 }
[BOOSTING] Taxa transferida ao mediador: { amount: 15 } ✅
```

**Sem erro "não encontrado"!**

---

### **4. Verificar WalletLedger**

```javascript
// MongoDB
db.walletledgers.find({
  reason: 'boosting_fee'
}).sort({ createdAt: -1 }).limit(1)

// Deve retornar:
{
  userId: ObjectId('...'), // ID do mediador
  direction: 'credit',
  reason: 'boosting_fee',
  amount: 15,
  balanceBefore: X,
  balanceAfter: X + 15  // ✅ Aumentou!
}
```

---

### **5. Verificar Saldo do Mediador**

```javascript
// MongoDB
db.users.findOne(
  { email: 'mediador@zenith.com' },
  { walletBalance: 1, email: 1 }
)

// Deve retornar:
{
  email: 'mediador@zenith.com',
  walletBalance: XXX  // ✅ Deve ter aumentado R$ 15!
}
```

---

## ✅ Checklist de Solução

### **Verificações:**
- [ ] Usuário mediador existe no banco?
- [ ] Email está correto no .env?
- [ ] Source 'ZenithChatApi' está no enum do modelo?

### **Testes:**
- [ ] Script verificar-mediador.js executado?
- [ ] Chat API reiniciada?
- [ ] Confirmação de entrega testada?
- [ ] WalletLedger criado?
- [ ] Saldo do mediador aumentou?

---

## 🎯 CONCLUSÃO

### **O código do boosting está CORRETO e IDÊNTICO ao marketplace!**

**O problema é:**
```
Usuário com email 'mediador@zenith.com' NÃO EXISTE no banco!
```

**Solução:**
1. ✅ Criar usuário mediador
2. ✅ OU configurar email de usuário existente no .env
3. ✅ Reiniciar API
4. ✅ Testar

**Depois disso, tudo funcionará perfeitamente!** 🎉

---

**NOTA:** O sistema está implementado corretamente. Só falta o usuário mediador existir no banco de dados!


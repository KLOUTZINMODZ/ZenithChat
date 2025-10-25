# 🔒 Correção de Segurança - WebSocket Data Exposure

## ⚠️ Vulnerabilidades Identificadas

### Problema Original

Dados sensíveis e manipuláveis sendo expostos em payloads WebSocket:

```json
{
  "type": "message:pending",
  "data": {
    "conversationId": "68f5271e230f3f1e763dffae",
    "messages": [{
      "_id": "68f924fab10d32848355bf27",
      "conversation": "68f5271e230f3f1e763dffae",
      "sender": {
        "_id": "68a27017da1e592e29195df1",
        "name": "allahu1233",
        "email": "klouts10@gmail.com",  ← ⚠️ EMAIL EXPOSTO
        "avatar": "https://i.ibb.co/hRPYDsjF/9e920fb9240464eb2cfcba5cc282632c.jpg"
      },
      "content": "🚫 Este chat expirou...",
      "metadata": {
        "type": "chat_expired",
        "expiredAt": "2025-10-22T18:39:54.857Z",
        "autoCleanup": true
      },
      "__v": 0  ← ⚠️ Metadado interno MongoDB
    }]
  }
}
```

### Riscos de Segurança

#### 1. **Exposição de Emails** 🔴 ALTO
- **Risco**: Emails completos visíveis para qualquer participante da conversa
- **Impacto**: 
  - Enumeration de usuários
  - Phishing direcionado
  - Spam
  - Engenharia social
- **Exploração**: Cliente manipula ID de conversa para ver emails de outros usuários

#### 2. **Dados Manipuláveis** 🟡 MÉDIO
- **Risco**: IDs e estruturas internas expostas
- **Impacto**:
  - Manipulação de IDs no client-side
  - Acesso não autorizado a recursos
  - Enumeration de conversas/mensagens
- **Exploração**: Força bruta de IDs para acessar conversas privadas

#### 3. **Metadados Internos** 🟡 MÉDIO
- **Risco**: Campos MongoDB (`__v`, `_id`, etc) expostos
- **Impacto**:
  - Informações sobre estrutura do banco
  - Fingerprinting da aplicação
  - Possível uso em ataques de injeção
- **Exploração**: Análise de padrões para exploits

#### 4. **Falta de Validação de Autorização** 🔴 ALTO
- **Risco**: Sem verificação se usuário pode acessar recurso
- **Impacto**:
  - Acesso não autorizado a conversas
  - Leitura de mensagens privadas
  - IDOR (Insecure Direct Object Reference)
- **Exploração**: Mudar `conversationId` para acessar chats alheios

## ✅ Soluções Implementadas

### 1. Camada de Sanitização de Dados

Criado **`src/utils/dataSanitizer.js`** com funções especializadas:

#### A. **Mascaramento de Email**
```javascript
// Antes: "joao.silva@gmail.com"
// Depois: "joa***@gmail.com"

function maskEmail(email) {
  const [localPart, domain] = email.split('@');
  const visibleChars = Math.min(3, localPart.length);
  const maskedLocal = localPart.substring(0, visibleChars) + '***';
  return `${maskedLocal}@${domain}`;
}
```

#### B. **Hash Anônimo de Email**
```javascript
// Gera hash único para comparações sem expor email
function hashEmail(email) {
  return crypto.createHash('sha256')
    .update(email.toLowerCase())
    .digest('hex')
    .substring(0, 16);
}
```

#### C. **Sanitização de Usuário**
```javascript
function sanitizeUserData(user, options = {}) {
  const { 
    includeEmail = false,       // Controle granular
    requesterId = null          // Verifica se é o próprio usuário
  } = options;
  
  const sanitized = {
    _id: user._id,
    name: user.name,
    avatar: user.avatar
  };
  
  // Email apenas se for o próprio usuário
  if (requesterId === user._id.toString()) {
    sanitized.email = user.email;
  } else if (includeEmail) {
    sanitized.emailMasked = maskEmail(user.email);
    sanitized.emailHash = hashEmail(user.email);
  }
  
  return sanitized;
}
```

#### D. **Sanitização de Mensagens**
```javascript
function sanitizeMessage(message, requesterId) {
  const sanitized = {
    _id: message._id,
    conversation: message.conversation,
    sender: sanitizeUserData(message.sender, { 
      includeEmail: false,  // Nunca expor email em mensagens
      requesterId 
    }),
    content: message.content,
    type: message.type,
    createdAt: message.createdAt
  };
  
  // Remove metadados internos
  if (message.metadata) {
    sanitized.metadata = {
      type: message.metadata.type,
      // Apenas campos seguros
      expiredAt: message.metadata.expiredAt,
      autoCleanup: message.metadata.autoCleanup
    };
  }
  
  return sanitized;
}
```

### 2. Aplicação em MessageHandler

**`src/websocket/handlers/MessageHandler.js`** - 9 pontos de sanitização:

```javascript
// 1. Ao enviar mensagem nova
const messageToSend = sanitizeMessage({
  ...message.toObject(),
  content: content
}, userId);

// 2. No histórico de mensagens
const sanitizedMessages = sanitizeMessages(decryptedMessages, userId);

// 3. Em mensagens pendentes (indexed strategy)
const sanitized = sanitizeMessages(decrypted, userId);

// 4. Em mensagens pendentes (legacy)
const sanitized = sanitizeMessages(decryptedMessages, userId);

// 5. Camada global no sendToUser
const sanitizedMessage = sanitizeWebSocketPayload(message, userId);
```

### 3. Aplicação em ConversationHandler

**`src/websocket/handlers/ConversationHandler.js`**:

```javascript
// Sanitizar participantes de conversas
plainConv.participants = plainConv.participants.map(p => {
  return sanitizeUserData(p, {
    includeEmail: false,      // Nunca expor email
    includeAvatar: true,
    includeId: true,
    requesterId: userId
  });
});
```

### 4. Validação de Autorização

```javascript
// Validar acesso a conversação
function validateConversationAccess(requesterId, conversation) {
  const requesterStr = requesterId.toString();
  
  return conversation.participants.some(participant => {
    const participantId = participant._id?.toString() || participant.toString();
    return participantId === requesterStr;
  });
}

// Uso no MessageHandler
const conversation = await Conversation.findById(conversationId);
if (!validateConversationAccess(userId, conversation)) {
  throw new Error('Access denied');
}
```

## 📊 Antes vs Depois

### Antes (Inseguro) ❌

```json
{
  "sender": {
    "_id": "68a27017da1e592e29195df1",
    "name": "allahu1233",
    "email": "klouts10@gmail.com",  ← EXPOSTO
    "avatar": "https://...",
    "__v": 0  ← INTERNO
  },
  "metadata": {
    "type": "chat_expired",
    "pendingRecipients": ["..."],  ← INTERNO
    "deliveryAttempts": 3  ← INTERNO
  }
}
```

### Depois (Seguro) ✅

```json
{
  "sender": {
    "_id": "68a27017da1e592e29195df1",
    "name": "allahu1233",
    "avatar": "https://..."
  },
  "metadata": {
    "type": "chat_expired",
    "expiredAt": "2025-10-22T18:39:54.857Z",
    "autoCleanup": true
  }
}
```

## 🎯 Proteções Implementadas

### ✅ 1. Remoção de Emails
- **Antes**: Email completo exposto em `sender`, `participants`, `client`, `booster`
- **Depois**: Email removido ou mascarado (`joa***@gmail.com`)
- **Exceção**: Usuário vê seu próprio email completo

### ✅ 2. Remoção de Metadados Internos
- **Removidos**: `__v`, `pendingRecipients`, `deliveryAttempts`, `cached_reason`
- **Mantidos**: Apenas campos necessários para UI (`type`, `expiredAt`, etc)

### ✅ 3. Sanitização em Múltiplas Camadas
```
┌──────────────────────────┐
│   Mensagem Original      │
└──────────┬───────────────┘
           │
    ┌──────▼──────────┐
    │  Sanitização 1  │ ← Por tipo (message, user, conversation)
    │  (específica)   │
    └──────┬──────────┘
           │
    ┌──────▼──────────┐
    │  Sanitização 2  │ ← Global (sendToUser)
    │  (payload WS)   │
    └──────┬──────────┘
           │
    ┌──────▼──────────┐
    │   WebSocket      │ → Cliente recebe dados limpos
    │   (envio)        │
    └──────────────────┘
```

### ✅ 4. Controle Granular
```javascript
// Diferentes níveis de exposição
sanitizeUserData(user, {
  includeEmail: false,        // Nunca em mensagens
  includeFullEmail: false,    // Apenas para o próprio usuário
  includeAvatar: true,        // Sempre seguro
  requesterId: userId         // Para verificar "é você?"
});
```

### ✅ 5. Validação de Acesso
- Verifica se `userId` está em `conversation.participants`
- Previne IDOR (Insecure Direct Object Reference)
- Bloqueia tentativas de acessar conversas alheias

## 🧪 Testes de Segurança

### Teste 1: Email Não Deve Ser Exposto

```javascript
// ANTES (FALHA)
const msg = await getMessageWebSocket(messageId);
console.log(msg.sender.email); // "user@example.com" ❌

// DEPOIS (PASSA)
const msg = await getMessageWebSocket(messageId);
console.log(msg.sender.email); // undefined ✅
console.log(msg.sender.name); // "Username" ✅
```

### Teste 2: Metadados Internos Não Devem Vazar

```javascript
// ANTES (FALHA)
const msg = await getMessageWebSocket(messageId);
console.log(msg.__v); // 0 ❌
console.log(msg.metadata.pendingRecipients); // ["..."] ❌

// DEPOIS (PASSA)
const msg = await getMessageWebSocket(messageId);
console.log(msg.__v); // undefined ✅
console.log(msg.metadata.pendingRecipients); // undefined ✅
```

### Teste 3: IDOR - Acesso Não Autorizado

```javascript
// Usuário A tenta acessar conversa do Usuário B

// ANTES (VULNERÁVEL)
ws.send({ type: 'get:history', conversationId: 'conversa_de_B' });
// Retorna mensagens ❌

// DEPOIS (PROTEGIDO)
ws.send({ type: 'get:history', conversationId: 'conversa_de_B' });
// Error: Access denied ✅
```

## 📋 Checklist de Segurança

- [x] **Emails removidos** de `sender`, `participants`, `client`, `booster`
- [x] **Metadados internos removidos** (`__v`, `pendingRecipients`, etc)
- [x] **Validação de autorização** em acesso a conversas
- [x] **Sanitização em múltiplas camadas** (específica + global)
- [x] **Mascaramento de email** quando necessário (opcional)
- [x] **Hash de email** para comparações anônimas
- [x] **Controle granular** de exposição de dados
- [x] **Documentação completa** de segurança

## 🚀 Arquivos Modificados

### Novos Arquivos
1. **`src/utils/dataSanitizer.js`** - Utilitário de sanitização

### Arquivos Modificados
1. **`src/websocket/handlers/MessageHandler.js`** - 9 pontos de sanitização
2. **`src/websocket/handlers/ConversationHandler.js`** - Sanitização de participantes

## 📚 Funções Disponíveis

```javascript
const {
  maskEmail,                     // Mascara email
  hashEmail,                     // Hash anônimo
  sanitizeUserData,              // Sanitiza usuário
  sanitizeMessage,               // Sanitiza mensagem
  sanitizeMessages,              // Sanitiza array de mensagens
  sanitizeConversation,          // Sanitiza conversa
  sanitizeWebSocketPayload,      // Sanitiza payload completo
  validateAccess,                // Valida acesso a recurso
  validateConversationAccess,    // Valida acesso a conversa
  removeInternalFields           // Remove campos internos
} = require('./utils/dataSanitizer');
```

## ⚠️ Importante

### O que FOI removido:
- ✅ Emails completos (exceto do próprio usuário)
- ✅ Metadados internos MongoDB (`__v`, etc)
- ✅ Campos de debugging (`cached_reason`, `deliveryAttempts`)
- ✅ Dados de participantes não necessários

### O que FOI mantido:
- ✅ IDs (necessários para funcionamento)
- ✅ Nomes e avatares (dados públicos)
- ✅ Metadados essenciais para UI (`type`, `expiredAt`, etc)
- ✅ Conteúdo das mensagens

## 🎓 Boas Práticas Aplicadas

1. **Defense in Depth**: Múltiplas camadas de sanitização
2. **Least Privilege**: Expor apenas dados necessários
3. **Data Minimization**: Remover tudo que não é essencial
4. **Separation of Concerns**: Sanitização separada da lógica de negócio
5. **Type Safety**: Validação de tipos antes de processar
6. **Access Control**: Verificação de autorização antes de retornar dados

## 📞 Manutenção Futura

Ao adicionar novos campos:
1. **Pergunte**: "Este campo precisa estar no WebSocket?"
2. **Avalie**: "Este campo é sensível ou manipulável?"
3. **Sanitize**: Use `dataSanitizer` se necessário
4. **Teste**: Verifique payload antes de fazer deploy

---

**Status**: ✅ **Implementado e Testado**  
**Impacto**: 🔒 **Eliminação de exposição de dados sensíveis**  
**Compatibilidade**: ✅ **Sem breaking changes** (cliente não depende de emails)

const crypto = require('crypto');

/**
 * Utilitários para sanitização de dados sensíveis
 * Protege contra exposição de informações manipuláveis e identificáveis
 */

/**
 * Mascarar email parcialmente (manter primeiros 3 chars + domínio)
 * Exemplo: joao.silva@gmail.com → joa***@gmail.com
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return null;
  
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return null;
  
  // Manter apenas primeiros 3 caracteres (ou menos se email for muito curto)
  const visibleChars = Math.min(3, localPart.length);
  const maskedLocal = localPart.substring(0, visibleChars) + '***';
  
  return `${maskedLocal}@${domain}`;
}

/**
 * Gerar hash anônimo do email para identificação única sem expor email
 * Útil para comparações client-side sem expor o email real
 */
function hashEmail(email) {
  if (!email || typeof email !== 'string') return null;
  
  // Hash SHA-256 do email (primeiros 16 caracteres suficientes)
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16);
}

/**
 * Sanitizar dados do usuário para envio via WebSocket
 * Remove/mascara informações sensíveis
 */
function sanitizeUserData(user, options = {}) {
  if (!user) return null;
  
  const {
    includeEmail = false,        // Se true, inclui email mascarado
    includeFullEmail = false,     // Se true, inclui email completo (USAR COM CUIDADO)
    includeAvatar = true,         // Se true, inclui avatar
    includeId = true,             // Se true, inclui _id
    requesterId = null            // ID do usuário que está fazendo request (para verificar se é o próprio)
  } = options;
  
  // Converter para objeto se for documento Mongoose
  const userObj = user.toObject ? user.toObject() : user;
  const userId = userObj._id?.toString() || userObj.id?.toString();
  
  // Se é o próprio usuário solicitando, pode ver mais informações
  const isSelf = requesterId && userId === requesterId.toString();
  
  const sanitized = {
    _id: includeId ? userId : undefined,
    name: userObj.name || 'Usuário'
  };
  
  // Email: apenas se for o próprio usuário ou explicitamente permitido
  if (isSelf || includeFullEmail) {
    sanitized.email = userObj.email;
  } else if (includeEmail && userObj.email) {
    sanitized.emailMasked = maskEmail(userObj.email);
    sanitized.emailHash = hashEmail(userObj.email);
  }
  
  // Avatar: incluir se permitido
  if (includeAvatar && userObj.avatar) {
    sanitized.avatar = userObj.avatar;
  }
  
  // Remover campos undefined
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] === undefined) {
      delete sanitized[key];
    }
  });
  
  return sanitized;
}

/**
 * Sanitizar mensagem para envio via WebSocket
 * Remove metadados internos e informações sensíveis
 */
function sanitizeMessage(message, requesterId = null) {
  if (!message) return null;
  
  const msgObj = message.toObject ? message.toObject() : message;
  
  const sanitized = {
    _id: msgObj._id,
    conversation: msgObj.conversation,
    sender: sanitizeUserData(msgObj.sender, {
      includeEmail: false,      // ✅ Nunca expor email em mensagens WebSocket
      includeAvatar: true,
      includeId: true,
      // ✅ NÃO passar requesterId para evitar exposição via isSelf
      requesterId: null  
    }),
    content: msgObj.content,
    type: msgObj.type || 'text',
    createdAt: msgObj.createdAt,
    updatedAt: msgObj.updatedAt
    // ✅ __v é automaticamente excluído (não está na lista)
  };
  
  // Incluir attachments se existir
  if (msgObj.attachments && msgObj.attachments.length > 0) {
    sanitized.attachments = msgObj.attachments;
  }
  
  // ✅ Incluir readBy mas sanitizar (remover _id interno)
  if (msgObj.readBy && Array.isArray(msgObj.readBy)) {
    sanitized.readBy = msgObj.readBy.map(read => ({
      user: read.user?.toString() || read.user,
      readAt: read.readAt
      // ✅ NÃO incluir _id interno do readBy
    }));
  }
  
  // Metadata: apenas incluir campos seguros
  if (msgObj.metadata) {
    sanitized.metadata = {
      type: msgObj.metadata.type,
      // Não incluir campos internos como pendingRecipients, deliveryAttempts, etc
    };
    
    // Incluir apenas metadados específicos seguros
    const safeMetadataFields = ['expiredAt', 'autoCleanup', 'proposalStatus'];
    safeMetadataFields.forEach(field => {
      if (msgObj.metadata[field] !== undefined) {
        sanitized.metadata[field] = msgObj.metadata[field];
      }
    });
  }
  
  return sanitized;
}

/**
 * Sanitizar múltiplas mensagens
 */
function sanitizeMessages(messages, requesterId = null) {
  if (!Array.isArray(messages)) return [];
  return messages.map(msg => sanitizeMessage(msg, requesterId));
}

/**
 * Sanitizar dados de conversação
 */
function sanitizeConversation(conversation, requesterId = null) {
  if (!conversation) return null;
  
  const convObj = conversation.toObject ? conversation.toObject() : conversation;
  
  const sanitized = {
    _id: convObj._id,
    type: convObj.type,
    isActive: convObj.isActive,
    status: convObj.status,
    lastMessageAt: convObj.lastMessageAt,
    createdAt: convObj.createdAt,
    updatedAt: convObj.updatedAt
  };
  
  // Participants: sanitizar dados de cada participante
  if (convObj.participants && Array.isArray(convObj.participants)) {
    sanitized.participants = convObj.participants.map(participant => 
      sanitizeUserData(participant, {
        includeEmail: false,
        includeAvatar: true,
        includeId: true,
        requesterId
      })
    );
  }
  
  // UnreadCount: apenas incluir o contador do próprio usuário
  if (convObj.unreadCount && requesterId) {
    const requesterIdStr = requesterId.toString();
    sanitized.unreadCount = convObj.unreadCount[requesterIdStr] || 0;
  }
  
  // LastMessage: sanitizar se existir
  if (convObj.lastMessage) {
    if (typeof convObj.lastMessage === 'object') {
      sanitized.lastMessage = sanitizeMessage(convObj.lastMessage, requesterId);
    } else {
      sanitized.lastMessage = convObj.lastMessage; // Apenas ID
    }
  }
  
  // Metadados seguros da conversação
  if (convObj.isTemporary !== undefined) {
    sanitized.isTemporary = convObj.isTemporary;
  }
  
  // IDs de marketplace/client/booster (sem dados sensíveis)
  if (convObj.marketplace) sanitized.marketplace = convObj.marketplace;
  if (convObj.client) sanitized.client = convObj.client;
  if (convObj.booster) sanitized.booster = convObj.booster;
  
  return sanitized;
}

/**
 * Sanitizar payload completo de WebSocket
 * Aplica sanitização recursiva em todos os campos
 */
function sanitizeWebSocketPayload(payload, requesterId = null) {
  if (!payload || typeof payload !== 'object') return payload;
  
  const sanitized = { ...payload };
  
  // Sanitizar data.message ou data.messages
  if (sanitized.data) {
    if (sanitized.data.message) {
      sanitized.data.message = sanitizeMessage(sanitized.data.message, requesterId);
    }
    
    if (Array.isArray(sanitized.data.messages)) {
      sanitized.data.messages = sanitizeMessages(sanitized.data.messages, requesterId);
    }
    
    if (sanitized.data.conversation) {
      sanitized.data.conversation = sanitizeConversation(sanitized.data.conversation, requesterId);
    }
    
    if (Array.isArray(sanitized.data.conversations)) {
      sanitized.data.conversations = sanitized.data.conversations.map(conv =>
        sanitizeConversation(conv, requesterId)
      );
    }
    
    // Sanitizar sender se existir
    if (sanitized.data.sender) {
      sanitized.data.sender = sanitizeUserData(sanitized.data.sender, {
        includeEmail: false,
        includeAvatar: true,
        requesterId
      });
    }
  }
  
  return sanitized;
}

/**
 * Validar se usuário tem permissão para acessar dados
 * Previne manipulação de IDs para acessar conversas de outros
 */
function validateAccess(requesterId, resourceOwnerId) {
  if (!requesterId || !resourceOwnerId) return false;
  
  const requesterStr = requesterId.toString();
  const ownerStr = resourceOwnerId.toString();
  
  return requesterStr === ownerStr;
}

/**
 * Validar se usuário é participante de uma conversação
 */
function validateConversationAccess(requesterId, conversation) {
  if (!requesterId || !conversation) return false;
  
  const convObj = conversation.toObject ? conversation.toObject() : conversation;
  const requesterStr = requesterId.toString();
  
  if (!convObj.participants || !Array.isArray(convObj.participants)) {
    return false;
  }
  
  return convObj.participants.some(participant => {
    const participantId = participant._id?.toString() || participant.toString();
    return participantId === requesterStr;
  });
}

/**
 * Remover campos internos/sensíveis de qualquer objeto
 */
function removeInternalFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const internal = [
    '__v',
    'password',
    'passwordHash',
    'resetToken',
    'verificationToken',
    'twoFactorSecret',
    'encryptedContent',
    'internalNotes',
    'adminNotes',
    'ipAddress',
    'userAgent'
  ];
  
  const cleaned = { ...obj };
  
  internal.forEach(field => {
    delete cleaned[field];
  });
  
  return cleaned;
}

module.exports = {
  maskEmail,
  hashEmail,
  sanitizeUserData,
  sanitizeMessage,
  sanitizeMessages,
  sanitizeConversation,
  sanitizeWebSocketPayload,
  validateAccess,
  validateConversationAccess,
  removeInternalFields
};

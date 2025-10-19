/**
 * Validador de Mensagens - Backend
 * Bloqueia números de telefone e URLs
 */

const PHONE_PATTERNS = [
  // Números brasileiros
  /(\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/g,
  /\+?\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{1,9}/g,
  /\(?\d{2}\)?\s?9?\s?\d{4}[-\s]?\d{4}/g,
  /\b\d{8,11}\b/g,
  /wa\.me\/\d+/gi,
  /t\.me\/[\w\d_]+/gi,
];

const URL_PATTERNS = [
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
  /(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{2,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
  /\b[a-zA-Z0-9-]+\.(com|net|org|br|io|me|ly|gl|co|app|dev|tech)\/[a-zA-Z0-9_-]+/gi,
  /instagram\.com\/[\w\.]+/gi,
  /facebook\.com\/[\w\.]+/gi,
  /twitter\.com\/[\w]+/gi,
  /tiktok\.com\/@[\w]+/gi,
  /linkedin\.com\/in\/[\w-]+/gi,
  /discord\.(gg|com\/invite)\/[\w-]+/gi,
  /t\.me\/[\w\d_]+/gi,
  /[-a-zA-Z0-9@:%._\+~#=]{1,256}[\(\[]\.[\)\]][a-zA-Z0-9()]{2,6}/gi,
  /[-a-zA-Z0-9@:%._\+~#=]{1,256}\s*\.\s*[a-zA-Z0-9()]{2,6}/gi,
];

const SUSPICIOUS_KEYWORDS = [
  'whatsapp', 'whats app', 'zap', 'telegram', 'discord',
  'instagram', 'insta', 'face', 'facebook', 'twitter',
  'tiktok', 'linkedin', 'contato', 'numero', 'número',
  'telefone', 'fone', 'celular', 'ligar', 'chamar', 'chama',
  'me add', 'me adiciona', 'adiciona ai', 'passa teu', 'passa seu',
  'manda teu', 'manda seu',
];

/**
 * Valida se contém número de telefone
 */
function containsPhoneNumber(message) {
  const normalized = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  const hasKeyword = SUSPICIOUS_KEYWORDS.some(keyword => normalized.includes(keyword));
  const hasNumbers = /\d{4,}/.test(message);
  
  if (hasKeyword && hasNumbers) {
    return true;
  }
  
  for (const pattern of PHONE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(message)) {
      const match = message.match(pattern);
      if (match && match[0].replace(/\D/g, '').length >= 8) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Valida se contém URL
 */
function containsURL(message) {
  const normalized = message.toLowerCase();
  
  for (const pattern of URL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(message)) {
      return true;
    }
  }
  
  const socialKeywords = ['@', 'arroba', 'perfil', 'profile', 'user', 'usuario'];
  const hasSocialKeyword = socialKeywords.some(keyword => normalized.includes(keyword));
  const hasSocialNetwork = SUSPICIOUS_KEYWORDS.slice(5, 11).some(network => normalized.includes(network));
  
  if (hasSocialKeyword && hasSocialNetwork) {
    return true;
  }
  
  return false;
}

/**
 * Valida mensagem completa
 */
function validateMessage(message) {
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { isValid: true };
  }
  
  if (containsPhoneNumber(message)) {
    return {
      isValid: false,
      reason: 'Não é permitido enviar números de telefone no chat',
      type: 'phone'
    };
  }
  
  if (containsURL(message)) {
    return {
      isValid: false,
      reason: 'Não é permitido enviar links ou URLs no chat',
      type: 'url'
    };
  }
  
  return { isValid: true };
}

/**
 * Sanitiza mensagem removendo conteúdo proibido
 */
function sanitizeMessage(message) {
  let sanitized = message;
  
  for (const pattern of URL_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[LINK REMOVIDO]');
  }
  
  for (const pattern of PHONE_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[NÚMERO REMOVIDO]');
  }
  
  return sanitized;
}

module.exports = {
  validateMessage,
  containsPhoneNumber,
  containsURL,
  sanitizeMessage
};

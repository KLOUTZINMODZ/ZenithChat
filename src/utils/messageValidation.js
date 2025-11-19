/**
 * Validação de mensagens para bloquear conteúdo restrito
 */

/**
 * Regex para detectar URLs
 * Detecta: http://, https://, www., domínios .com, .br, etc.
 */
const URL_PATTERNS = [
  // URLs com protocolo
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
  // URLs sem protocolo (www.)
  /www\.[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
  // Domínios comuns sem www
  /\b[a-zA-Z0-9][-a-zA-Z0-9]{0,62}(\.[a-zA-Z0-9][-a-zA-Z0-9]{0,62})*\.(com|net|org|br|io|app|dev|co|me|info|biz|online|site|tech|store|shop|xyz|club|link|tv|us|uk|ca|au|de|fr|es|it|ru|cn|jp|in|edu|gov|mil)\b/gi,
  // Links encurtados
  /\b(bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|short\.link|cutt\.ly|rb\.gy|is\.gd|buff\.ly|adf\.ly|t\.co)\/[a-zA-Z0-9]+/gi,
];

/**
 * Regex para detectar números de telefone
 * Formatos suportados:
 * - +55 (11) 98888-8888
 * - (11) 98888-8888
 * - 11 98888-8888
 * - 11988888888
 * - +5511988888888
 * - Números internacionais
 */
const PHONE_PATTERNS = [
  // Formato brasileiro com +55
  /\+55\s*\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/g,
  // Formato brasileiro sem +55
  /\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/g,
  // Números sequenciais (9+ dígitos)
  /\b\d{9,15}\b/g,
  // Formato internacional
  /\+\d{1,3}\s*\(?\d{1,4}\)?\s*\d{4,10}[-\s]?\d{0,10}/g,
];

/**
 * Palavras-chave relacionadas a contato externo
 */
const CONTACT_KEYWORDS = [
  /whats\s*app/gi,
  /telegram/gi,
  /discord/gi,
  /skype/gi,
  /\bwpp\b/gi,
  /\bzap\b/gi,
  /me\s*liga/gi,
  /ligue\s*para/gi,
  /chama\s*no/gi,
  /adiciona\s*no/gi,
];

/**
 * Valida se uma mensagem contém URLs
 * @param {string} text - Texto a ser validado
 * @returns {boolean}
 */
const containsURL = (text) => {
  return URL_PATTERNS.some(pattern => {
    pattern.lastIndex = 0; // Reset regex state
    return pattern.test(text);
  });
};

/**
 * Valida se uma mensagem contém números de telefone
 * @param {string} text - Texto a ser validado
 * @returns {boolean}
 */
const containsPhoneNumber = (text) => {
  // Remove pontuação comum que não faz parte de telefones
  const cleanText = text.replace(/[,;.!?]/g, ' ');
  
  return PHONE_PATTERNS.some(pattern => {
    pattern.lastIndex = 0; // Reset regex state
    const matches = cleanText.match(pattern);
    if (!matches) return false;
    
    // Filtrar falsos positivos (números muito curtos ou muito longos)
    return matches.some(match => {
      const digitsOnly = match.replace(/\D/g, '');
      // Aceitar apenas números com 8-15 dígitos (telefones válidos)
      return digitsOnly.length >= 8 && digitsOnly.length <= 15;
    });
  });
};

/**
 * Valida se uma mensagem contém palavras-chave de contato externo
 * @param {string} text - Texto a ser validado
 * @returns {boolean}
 */
const containsContactKeywords = (text) => {
  return CONTACT_KEYWORDS.some(pattern => {
    pattern.lastIndex = 0; // Reset regex state
    return pattern.test(text);
  });
};

/**
 * Valida uma mensagem completa
 * @param {string} content - Conteúdo da mensagem
 * @returns {{isValid: boolean, reason?: string, detectedContent?: string}}
 */
const validateMessage = (content) => {
  if (!content || typeof content !== 'string') {
    return { isValid: false, reason: 'Mensagem inválida' };
  }

  const text = content.trim();
  
  if (!text) {
    return { isValid: false, reason: 'Mensagem vazia' };
  }

  // Verificar URLs
  if (containsURL(text)) {
    return {
      isValid: false,
      reason: 'Não é permitido enviar links ou URLs no chat',
      detectedContent: 'URL/Link'
    };
  }

  // Verificar números de telefone
  if (containsPhoneNumber(text)) {
    return {
      isValid: false,
      reason: 'Não é permitido enviar números de telefone no chat',
      detectedContent: 'Número de telefone'
    };
  }

  // Verificar palavras-chave suspeitas combinadas com números
  if (containsContactKeywords(text) && /\d{8,}/.test(text.replace(/\D/g, ''))) {
    return {
      isValid: false,
      reason: 'Não é permitido compartilhar informações de contato externo',
      detectedContent: 'Informações de contato'
    };
  }

  return { isValid: true };
};

module.exports = {
  validateMessage,
  containsURL,
  containsPhoneNumber,
  containsContactKeywords,
};

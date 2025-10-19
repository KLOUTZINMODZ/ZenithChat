/**
 * Message Content Validator - Backend
 * Valida conteúdo de mensagens para prevenir compartilhamento de informações sensíveis
 */

/**
 * Regex patterns para detecção de conteúdo proibido
 */
const PHONE_PATTERNS = [
  // Telefones brasileiros (com ou sem código do país)
  /(\+?55\s?)?(\(?\d{2}\)?[\s-]?)?\d{4,5}[\s-]?\d{4}/g,
  
  // Telefones internacionais genéricos
  /(\+?\d{1,4}[\s-]?)?(\(?\d{2,4}\)?[\s-]?)?\d{3,5}[\s-]?\d{3,5}/g,
  
  // WhatsApp, Telegram mencionados
  /(whats?app|telegram|zap|tel|celular|fone|telefone|contato)[\s:]*([\d\s\-\(\)]+)/gi,
  
  // Números sequenciais que parecem telefones
  /\b\d{8,15}\b/g
];

const URL_PATTERNS = [
  // URLs com protocolo
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
  
  // URLs sem protocolo
  /(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-zA-Z]{2,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
  
  // Menções a sites/links
  /(site|link|url|página|page|website|web)[\s:]*([-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6})/gi,
  
  // Domínios comuns sem protocolo
  /\b[a-zA-Z0-9][\w\-]*\.(com|net|org|br|io|co|app|xyz|online|site|store|shop)\b/gi
];

const EMAIL_PATTERNS = [
  // Email padrão
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
  
  // Menções a email
  /(email|e-mail|mail|gmail|hotmail|outlook)[\s:]*([\w._%+-]+@[\w.-]+\.[a-zA-Z]{2,})?/gi
];

/**
 * Lista de exceções - palavras que não devem ser bloqueadas
 */
const WHITELIST = [
  'zenithgg.com.br',
  'hacklotesite.vercel.app',
  'zenith.enrelyugi.com.br',
  // Termos comuns que podem gerar falsos positivos
  '2024', '2025', '2026', // Anos
  'rank', 'elo', 'mmr', // Termos de jogos
];

/**
 * Verifica se a mensagem contém números de telefone
 */
function containsPhoneNumber(text) {
  // Remover exceções conhecidas
  let cleanText = text;
  WHITELIST.forEach(word => {
    cleanText = cleanText.replace(new RegExp(word, 'gi'), '');
  });

  for (const pattern of PHONE_PATTERNS) {
    const matches = cleanText.match(pattern);
    if (matches) {
      // Verificar se é realmente um telefone (mínimo 8 dígitos)
      for (const match of matches) {
        const digitsOnly = match.replace(/\D/g, '');
        if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Verifica se a mensagem contém URLs
 */
function containsURL(text) {
  // Remover exceções conhecidas
  let cleanText = text;
  WHITELIST.forEach(word => {
    cleanText = cleanText.replace(new RegExp(word, 'gi'), '');
  });

  for (const pattern of URL_PATTERNS) {
    if (pattern.test(cleanText)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Valida o conteúdo da mensagem
 */
function validateMessageContent(content) {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { isValid: false, reason: 'Mensagem vazia' };
  }

  // Verificar telefone
  if (containsPhoneNumber(content)) {
    return {
      isValid: false,
      reason: 'Não é permitido compartilhar números de telefone no chat',
      detectedType: 'phone'
    };
  }

  // Verificar URL
  if (containsURL(content)) {
    return {
      isValid: false,
      reason: 'Não é permitido compartilhar links ou URLs no chat',
      detectedType: 'url'
    };
  }

  return { isValid: true };
}

/**
 * Obter mensagem de erro amigável
 */
function getValidationErrorMessage(result) {
  if (result.isValid) return '';
  
  const messages = {
    phone: '🚫 Não é permitido compartilhar números de telefone. Toda comunicação deve ocorrer pela plataforma.',
    url: '🚫 Não é permitido compartilhar links externos. Mantenha a comunicação dentro da plataforma.',
    email: '🚫 Não é permitido compartilhar endereços de email. Use apenas o chat da plataforma.'
  };

  return messages[result.detectedType] || result.reason || 'Conteúdo não permitido';
}

module.exports = {
  validateMessageContent,
  getValidationErrorMessage
};

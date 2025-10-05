/**
 * Lista de provedores de email confiáveis
 * Atualizado em 2024 com base nas principais plataformas
 */

const TRUSTED_EMAIL_PROVIDERS = [
  // Principais provedores globais
  'gmail.com',
  'googlemail.com', // Gmail alternativo
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  
  // Yahoo
  'yahoo.com',
  'yahoo.com.br',
  'ymail.com',
  'rocketmail.com',
  
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  
  // Provedores focados em privacidade
  'protonmail.com',
  'proton.me',
  'tutanota.com',
  'tutamail.com',
  
  // Provedores corporativos/profissionais
  'zoho.com',
  'zohomail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'aol.com',
  
  // Provedores brasileiros confiáveis
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'ig.com.br',
  'globo.com',
  'globomail.com',
  
  // Provedores educacionais (geralmente confiáveis)
  'edu',
  'edu.br',
  'ac.uk',
  
  // Outros provedores conhecidos
  'fastmail.com',
  'yandex.com',
  'mail.ru',
  'qq.com', // China
  '163.com', // China
  'naver.com', // Coreia
  'daum.net', // Coreia
];

/**
 * Verifica se um email usa um provedor confiável
 * @param {string} email - Email para verificar
 * @returns {boolean} - True se o provedor é confiável
 */
function isEmailFromTrustedProvider(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const emailLower = email.toLowerCase().trim();
  const domain = emailLower.split('@')[1];

  if (!domain) {
    return false;
  }

  // Verificação exata
  if (TRUSTED_EMAIL_PROVIDERS.includes(domain)) {
    return true;
  }

  // Verificação de domínios educacionais
  if (domain.endsWith('.edu') || domain.endsWith('.edu.br') || domain.endsWith('.ac.uk')) {
    return true;
  }

  // Verificação de subdomínios de provedores confiáveis
  for (const provider of TRUSTED_EMAIL_PROVIDERS) {
    if (domain.endsWith('.' + provider)) {
      return true;
    }
  }

  return false;
}

/**
 * Obtém mensagem de erro personalizada para email não confiável
 * @param {string} email - Email rejeitado
 * @returns {string} - Mensagem de erro
 */
function getUntrustedEmailMessage(email) {
  const domain = email.split('@')[1];
  return `O domínio "${domain}" não é permitido. Use um provedor confiável como Gmail, Outlook, Yahoo, etc.`;
}

module.exports = {
  TRUSTED_EMAIL_PROVIDERS,
  isEmailFromTrustedProvider,
  getUntrustedEmailMessage
};

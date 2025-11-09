/**
 * Constantes de limites de preços do sistema
 * 
 * Limites aplicados a:
 * - Propostas de boosting
 * - Pedidos de boosting
 * - Itens do marketplace
 * - Transações em geral
 * 
 * IMPORTANTE: Estes limites devem ser sincronizados com o front-end
 */

const PRICE_LIMITS = {
  // Limite mínimo: R$ 5,00
  // Razão: Garante viabilidade do sistema de mediação
  // Valores muito baixos resultam em taxas < 1 centavo (inviáveis)
  MIN: 5.00,

  // Limite máximo: R$ 99.999,00
  // Razão: Segurança e compatibilidade com sistema de pagamento
  MAX: 99999.00,

  // Mensagens de erro padronizadas
  ERRORS: {
    TOO_LOW: `O valor mínimo permitido é R$ 5,00. Valores abaixo disso não são viáveis para o sistema de mediação.`,
    TOO_HIGH: `O valor máximo permitido é R$ 99.999,00.`,
    INVALID: 'O valor informado é inválido.',
    REQUIRED: 'O preço é obrigatório.'
  }
};

/**
 * Valida se um preço está dentro dos limites permitidos
 * @param {number} price - Preço a ser validado
 * @param {object} options - Opções de validação
 * @returns {object} { valid: boolean, error: string | null }
 */
function validatePrice(price, options = {}) {
  const {
    fieldName = 'preço',
    allowZero = false,
    customMin = PRICE_LIMITS.MIN,
    customMax = PRICE_LIMITS.MAX
  } = options;

  // Verificar se é número
  const numPrice = Number(price);
  if (isNaN(numPrice)) {
    return {
      valid: false,
      error: `${fieldName} inválido. Informe um valor numérico.`
    };
  }

  // Verificar se é negativo
  if (numPrice < 0) {
    return {
      valid: false,
      error: `${fieldName} não pode ser negativo.`
    };
  }

  // Verificar zero (se não for permitido)
  if (!allowZero && numPrice === 0) {
    return {
      valid: false,
      error: `${fieldName} não pode ser zero.`
    };
  }

  // Verificar limite mínimo
  if (numPrice > 0 && numPrice < customMin) {
    return {
      valid: false,
      error: `${fieldName} mínimo é R$ ${customMin.toFixed(2).replace('.', ',')}.`
    };
  }

  // Verificar limite máximo
  if (numPrice > customMax) {
    return {
      valid: false,
      error: `${fieldName} máximo é R$ ${customMax.toFixed(2).replace('.', ',')}.`
    };
  }

  return {
    valid: true,
    error: null,
    value: numPrice
  };
}

/**
 * Middleware Express para validar preços
 * @param {string} fieldPath - Caminho do campo no req (ex: 'body.price', 'body.proposedPrice')
 * @param {object} options - Opções de validação
 */
function validatePriceMiddleware(fieldPath, options = {}) {
  return (req, res, next) => {
    const pathParts = fieldPath.split('.');
    let value = req;
    
    for (const part of pathParts) {
      value = value[part];
      if (value === undefined) {
        return res.status(400).json({
          success: false,
          message: PRICE_LIMITS.ERRORS.REQUIRED
        });
      }
    }

    const validation = validatePrice(value, options);
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error
      });
    }

    next();
  };
}

module.exports = {
  PRICE_LIMITS,
  validatePrice,
  validatePriceMiddleware
};

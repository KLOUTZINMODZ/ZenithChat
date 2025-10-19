const crypto = require('crypto');

const algorithm = 'aes-256-gcm';
const secretKey = process.env.MESSAGE_ENCRYPTION_KEY || 'default_32_character_encryption_key_change_me!!';
const ENCRYPTION_ENABLED = String(process.env.MESSAGE_ENCRYPTION_ENABLED || 'true').toLowerCase() !== 'false';


const key = crypto.scryptSync(secretKey, 'salt', 32);

function encryptMessage(text) {
  try {
    if (!ENCRYPTION_ENABLED) {
      // Feature flag: store plaintext for new messages
      return text;
    }
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    return text;
  }
}

function decryptMessage(encryptedText) {
  try {
    // Validação inicial
    if (!encryptedText || typeof encryptedText !== 'string') {
      return encryptedText;
    }

    // If plaintext (feature flag disabled or legacy plaintext), passthrough
    const parts = String(encryptedText).split(':');
    if (parts.length !== 3) {
      return encryptedText; // Provavelmente texto plano
    }
    
    // Validar que as partes existem e têm conteúdo
    if (!parts[0] || !parts[1] || !parts[2]) {
      return encryptedText;
    }

    // Tentar converter IV e authTag
    let iv, authTag;
    try {
      iv = Buffer.from(parts[0], 'hex');
      authTag = Buffer.from(parts[1], 'hex');
    } catch (err) {
      return encryptedText;
    }

    // Validar tamanhos
    if (iv.length !== 16) {
      return encryptedText;
    }

    if (authTag.length !== 16) {
      return encryptedText;
    }

    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // Retorna texto original silenciosamente se falhar
    return encryptedText;
  }
}

module.exports = {
  encryptMessage,
  decryptMessage
};

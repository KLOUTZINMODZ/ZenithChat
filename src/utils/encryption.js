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
    // If plaintext (feature flag disabled or legacy plaintext), passthrough
    const parts = String(encryptedText || '').split(':');
    if (parts.length !== 3) {
      return encryptedText;
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return encryptedText;
  }
}

module.exports = {
  encryptMessage,
  decryptMessage
};

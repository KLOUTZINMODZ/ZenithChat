const mongoose = require('mongoose');

const twoFactorAuthSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  code: {
    type: String,
    required: true
  },
  tempToken: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  used: {
    type: Boolean,
    default: false,
    index: true
  },
  usedAt: {
    type: Date,
    default: null
  },
  // Proteção contra bruteforce
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 5
  },
  lockedUntil: {
    type: Date,
    default: null
  },
  // IP e User-Agent para auditoria (sem expor em logs)
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// Index composto para limpeza eficiente de registros expirados
twoFactorAuthSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Verificar se o código está bloqueado por tentativas excessivas
twoFactorAuthSchema.methods.isLocked = function() {
  if (!this.lockedUntil) return false;
  
  const now = new Date();
  if (now < this.lockedUntil) {
    return true;
  }
  
  // Desbloqueio automático após expiração
  this.lockedUntil = null;
  this.attempts = 0;
  return false;
};

// Verificar se o código expirou
twoFactorAuthSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

// Incrementar tentativas e bloquear se necessário
twoFactorAuthSchema.methods.incrementAttempts = async function() {
  this.attempts += 1;
  
  // Bloquear após exceder tentativas máximas
  if (this.attempts >= this.maxAttempts) {
    // Bloquear por 15 minutos
    this.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
  }
  
  return this.save();
};

// Marcar como usado (proteção contra replay attack)
twoFactorAuthSchema.methods.markAsUsed = async function() {
  this.used = true;
  this.usedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('TwoFactorAuth', twoFactorAuthSchema);

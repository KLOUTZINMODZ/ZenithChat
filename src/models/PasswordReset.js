const mongoose = require('mongoose');

const passwordResetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  code: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index para auto-deletar documentos expirados
  },
  used: {
    type: Boolean,
    default: false
  },
  attempts: {
    type: Number,
    default: 0
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Índice composto para busca eficiente
passwordResetSchema.index({ email: 1, code: 1, used: 1 });

// Método para verificar se o código está expirado
passwordResetSchema.methods.isExpired = function() {
  return Date.now() > this.expiresAt;
};

// Método para verificar tentativas
passwordResetSchema.methods.canAttempt = function() {
  return this.attempts < 5; // Máximo 5 tentativas
};

module.exports = mongoose.model('PasswordReset', passwordResetSchema);

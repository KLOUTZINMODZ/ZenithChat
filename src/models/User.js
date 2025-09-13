const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  cpfCnpj: {
    type: String,
    default: null,
    trim: true
  },
  avatar: {
    type: String,
    default: null
  },
  walletBalance: {
    type: Number,
    default: 0
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  preferences: {
    notifications: {

      type: mongoose.Schema.Types.Mixed,
      default: true
    },
    sound: {
      type: Boolean,
      default: true
    }
  },

  pixKeyType: {
    type: String,
    enum: ['PHONE', 'CPF', 'CNPJ', null],
    default: null
  },
  pixKeyNormalized: {
    type: String,
    default: null
  },

  pixKeyFingerprint: {
    type: String,
    unique: true,
    sparse: true,
    default: null
  },
  pixKeyLocked: {
    type: Boolean,
    default: false
  },
  pixKeyLinkedAt: {
    type: Date,
    default: null
  },
  pixKeyFirstWithdrawAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});


userSchema.index({ email: 1 });
userSchema.index({ pixKeyFingerprint: 1 }, { unique: true, sparse: true });


userSchema.virtual('displayName').get(function() {
  return this.name || this.email.split('@')[0];
});


userSchema.methods.updateLastSeen = function() {
  this.lastSeen = new Date();
  return this.save();
};


userSchema.methods.setOnlineStatus = function(isOnline) {
  this.isOnline = isOnline;
  if (!isOnline) {
    this.lastSeen = new Date();
  }
  return this.save();
};

module.exports = mongoose.model('User', userSchema);

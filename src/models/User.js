const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  legalName: {
    type: String,
    default: null,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  birthDate: {
    type: Date,
    default: null
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
  // Contact numbers
  phone: {
    type: String,
    default: null,
    trim: true
  },
  phoneNumber: {
    type: String,
    default: null,
    trim: true
  },
  whatsapp: {
    type: String,
    default: null,
    trim: true
  },
  mobile: {
    type: String,
    default: null,
    trim: true
  },
  phoneNormalized: {
    type: String,
    default: null,
    trim: true
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
  // Complaints counters
  complaintsSent: {
    type: Number,
    default: 0
  },
  complaintsReceived: {
    type: Number,
    default: 0
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
userSchema.index({ phoneNormalized: 1 }, { sparse: true });
userSchema.index({ complaintsReceived: -1 });
userSchema.index({ complaintsSent: -1 });


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

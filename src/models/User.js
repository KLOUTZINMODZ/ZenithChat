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

  // Achievements (Conquistas)
  achievements: {
    unlocked: {
      type: [{
        achievementId: { type: String, required: true },
        unlockedAt: { type: Date, default: Date.now },
        notified: { type: Boolean, default: false }
      }],
      default: []
    },
    stats: {
      totalSales: { type: Number, default: 0 },
      totalPurchases: { type: Number, default: 0 },
      totalTransactions: { type: Number, default: 0 },
      averageRating: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
      highestBalance: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now }
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
userSchema.index({ phoneNormalized: 1 }, { unique: true, sparse: true });
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

// Achievement methods
userSchema.methods.hasAchievement = function(achievementId) {
  if (!this.achievements || !this.achievements.unlocked) return false;
  return this.achievements.unlocked.some(a => a.achievementId === achievementId);
};

userSchema.methods.unlockAchievement = function(achievementId) {
  if (!this.achievements) {
    this.achievements = { unlocked: [], stats: {} };
  }
  if (!this.achievements.unlocked) {
    this.achievements.unlocked = [];
  }
  
  // Verificar se já foi desbloqueada
  if (this.hasAchievement(achievementId)) {
    return { alreadyUnlocked: true };
  }
  
  // Adicionar nova conquista
  this.achievements.unlocked.push({
    achievementId,
    unlockedAt: new Date(),
    notified: false
  });
  
  return { alreadyUnlocked: false, achievement: achievementId };
};

userSchema.methods.updateAchievementStats = function(stats) {
  if (!this.achievements) {
    this.achievements = { unlocked: [], stats: {} };
  }
  if (!this.achievements.stats) {
    this.achievements.stats = {};
  }
  
  // Atualizar estatísticas
  this.achievements.stats = {
    ...this.achievements.stats,
    ...stats,
    lastUpdated: new Date()
  };
  
  // Atualizar highestBalance se necessário
  if (stats.currentBalance && stats.currentBalance > (this.achievements.stats.highestBalance || 0)) {
    this.achievements.stats.highestBalance = stats.currentBalance;
  }
};

module.exports = mongoose.model('User', userSchema);

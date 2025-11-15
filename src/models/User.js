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
  googleId: {
    type: String,
    unique: true,
    sparse: true, // Permite null mas deve ser único se existir
    default: null
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
  profileImage: {
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
  // Boosting statistics
  totalBoosts: {
    type: Number,
    default: 0,
    index: true
  },
  completedBoosts: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
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
  // Lista de itens favoritos do usuário
  favorites: {
    type: [{
      itemId: { type: String, required: true },
      title: { type: String, required: true },
      price: { type: Number, required: true },
      image: { type: String, default: null },
      category: { type: String, default: null },
      addedAt: { type: Date, default: Date.now }
    }],
    default: []
  },
  
  preferences: {
    notifications: {
      newProposal: {
        type: Boolean,
        default: true
      },
      proposalAccepted: {
        type: Boolean,
        default: true
      },
      newBoosting: {
        type: Boolean,
        default: false
      },
      boostingCompleted: {
        type: Boolean,
        default: true
      }
    },
    watchedGames: {
      type: [String],
      default: []
    },
    watchedGameIds: {
      type: [Number],
      default: []
    },
    emailNotifications: {
      type: Boolean,
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
    default: null
    // Índice definido explicitamente abaixo com { unique: true, sparse: true }
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
  },
  
  // Sistema de Banimento
  banned: {
    type: Boolean,
    default: false,
    index: true
  },
  bannedAt: {
    type: Date,
    default: null
  },
  bannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  bannedReason: {
    type: String,
    default: null
  },
  bannedUntil: {
    type: Date,
    default: null // null = banimento permanente
  }
}, {
  timestamps: true,
  autoIndex: false // Desabilita criação automática de índices (evita conflitos)
});


userSchema.index({ email: 1 });
userSchema.index({ pixKeyFingerprint: 1 }, { unique: true, sparse: true });
userSchema.index({ phoneNormalized: 1 }, { unique: true, sparse: true });
userSchema.index({ complaintsReceived: -1 });
userSchema.index({ complaintsSent: -1 });

// ==================== HOOKS ====================

/**
 * PRE-SAVE HOOK: Normalizar telefone automaticamente
 * CRÍTICO: Previne erro E11000 duplicate key error em phoneNormalized
 * 
 * Problema: Se phone existe mas phoneNormalized é null, múltiplos usuários 
 * terão phoneNormalized: null, violando índice unique.
 * 
 * Solução: Sempre que phone é definido, phoneNormalized é automaticamente 
 * preenchido com o telefone normalizado (apenas dígitos).
 */
userSchema.pre('save', function(next) {
  // Se telefone foi modificado ou é novo, normalizar
  if (this.isModified('phone') || this.isNew) {
    if (this.phone && typeof this.phone === 'string') {
      // Normalizar: remover tudo que não for dígito
      const normalized = this.phone.replace(/\D/g, '');
      
      // Só definir phoneNormalized se temos dígitos
      if (normalized.length > 0) {
        this.phoneNormalized = normalized;
        console.log(`[User Model] 📱 Telefone normalizado: ${this.phone} → ${normalized}`);
      } else {
        // Se phone está vazio ou inválido, garantir que phoneNormalized seja null
        this.phoneNormalized = null;
      }
    } else {
      // Se phone é null/undefined, phoneNormalized também deve ser null
      this.phoneNormalized = null;
    }
  }
  
  next();
});


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

// Métodos de Banimento
userSchema.methods.isBanned = function() {
  if (!this.banned) return false;
  
  // Se tem data de expiração, verificar se ainda está banido
  if (this.bannedUntil) {
    const now = new Date();
    if (now > this.bannedUntil) {
      // Banimento expirou, desbanir automaticamente
      this.banned = false;
      this.bannedUntil = null;
      return false;
    }
  }
  
  return true;
};

userSchema.methods.banUser = function(reason, bannedBy, duration = null) {
  this.banned = true;
  this.bannedAt = new Date();
  this.bannedReason = reason;
  this.bannedBy = bannedBy;
  
  if (duration) {
    // Banimento temporário (duration em dias)
    this.bannedUntil = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
  } else {
    // Banimento permanente
    this.bannedUntil = null;
  }
  
  return this.save();
};

userSchema.methods.unbanUser = function() {
  this.banned = false;
  this.bannedUntil = null;
  return this.save();
};

/**
 * Garante que os índices estejam corretos no banco de dados
 * Corrige o problema do índice phoneNormalized sem sparse
 */
userSchema.statics.ensureIndexes = async function() {
  try {
    const collection = this.collection;
    const indexes = await collection.indexes();
    
    // Verificar se phoneNormalized_1 existe e está correto
    const phoneIndex = indexes.find(idx => idx.name === 'phoneNormalized_1');
    
    if (phoneIndex && phoneIndex.unique && !phoneIndex.sparse) {
      console.log('⚠️  [User Model] Corrigindo índice phoneNormalized...');
      
      // Remover índice antigo
      await collection.dropIndex('phoneNormalized_1');
      console.log('✅ [User Model] Índice antigo removido');
      
      // Criar novo índice correto
      await collection.createIndex(
        { phoneNormalized: 1 }, 
        { unique: true, sparse: true, name: 'phoneNormalized_1' }
      );
      console.log('✅ [User Model] Índice phoneNormalized criado corretamente (unique + sparse)');
    } else if (!phoneIndex) {
      // Criar índice se não existir
      await collection.createIndex(
        { phoneNormalized: 1 }, 
        { unique: true, sparse: true, name: 'phoneNormalized_1' }
      );
      console.log('✅ [User Model] Índice phoneNormalized criado');
    } else {
      console.log('✅ [User Model] Índice phoneNormalized já está correto');
    }
  } catch (error) {
    console.error('❌ [User Model] Erro ao garantir índices:', error.message);
  }
};

module.exports = mongoose.model('User', userSchema);

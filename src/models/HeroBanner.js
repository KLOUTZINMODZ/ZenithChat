const mongoose = require('mongoose');

const heroBannerSchema = new mongoose.Schema({
  // Ordem de exibição (1 = primeiro)
  order: {
    type: Number,
    required: true,
    default: 1,
    min: 1,
    max: 6
  },
  
  // Título principal
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  
  // Texto destacado (gradiente)
  highlightText: {
    type: String,
    trim: true,
    maxlength: 100
  },
  
  // Descrição/subtítulo
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300
  },
  
  // URL da imagem de fundo (referência ao upload)
  backgroundImage: {
    type: String,
    required: true
  },
  
  // Badge/Pill (ex: "Novo", "Promoção")
  badge: {
    text: {
      type: String,
      trim: true,
      maxlength: 20
    },
    color: {
      type: String,
      enum: ['blue', 'purple', 'green', 'red', 'yellow', 'orange'],
      default: 'purple'
    }
  },
  
  // Botão principal
  primaryButton: {
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
      default: 'Explorar'
    },
    link: {
      type: String,
      required: true,
      trim: true,
      default: '/marketplace'
    }
  },
  
  // Botão secundário (opcional)
  secondaryButton: {
    text: {
      type: String,
      trim: true,
      maxlength: 30
    },
    link: {
      type: String,
      trim: true
    }
  },
  
  // Status (ativo/inativo)
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Middleware para atualizar updatedAt
heroBannerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index para buscar banners ativos ordenados
heroBannerSchema.index({ isActive: 1, order: 1 });

module.exports = mongoose.model('HeroBanner', heroBannerSchema, 'herobanners');

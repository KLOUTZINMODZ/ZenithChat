const mongoose = require('mongoose');

const uploadedImageSchema = new mongoose.Schema({
  // Identificador único da imagem
  imageId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Conversação associada (opcional para imagens de marketplace)
  conversationId: {
    type: String,
    required: false,
    index: true
  },
  
  // Tipo de imagem: 'conversation' ou 'marketplace'
  imageType: {
    type: String,
    enum: ['conversation', 'marketplace'],
    default: 'conversation',
    index: true
  },
  
  // Buffer da imagem completa (AVIF)
  fullImage: {
    type: Buffer,
    required: true
  },
  
  // Buffer da thumbnail (AVIF)
  thumbImage: {
    type: Buffer,
    required: true
  },
  
  // Buffer da imagem completa (JPEG fallback)
  fullImageJpeg: {
    type: Buffer,
    required: true
  },
  
  // Buffer da thumbnail (JPEG fallback)
  thumbImageJpeg: {
    type: Buffer,
    required: true
  },
  
  // Metadados
  metadata: {
    originalName: String,
    originalSize: Number,
    originalMimeType: String,
    width: Number,
    height: Number,
    conversationId: String
  },
  
  // URLs públicas (para compatibilidade)
  urls: {
    full: String,
    thumb: String,
    fullJpeg: String,
    thumbJpeg: String
  },
  
  // Controle
  uploadedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Flag para nunca deletar
  permanent: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Índice composto para busca rápida
uploadedImageSchema.index({ conversationId: 1, uploadedAt: -1 });

// Método estático para buscar imagem por URL
uploadedImageSchema.statics.findByUrl = function(url) {
  // Extrai o imageId da URL
  // Exemplo: /uploads/conversationId/2024/1/12345_abc.avif
  const match = url.match(/\/uploads\/.+?\/(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg)$/i);
  if (!match) return null;
  
  const imageId = match[1];
  return this.findOne({ imageId });
};

const UploadedImage = mongoose.model('UploadedImage', uploadedImageSchema);

module.exports = UploadedImage;

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
    index: true,
    sparse: true
  },

  // Usuário associado (para imagens de perfil)
  userId: {
    type: String,
    required: false,
    index: true,
    sparse: true
  },
  
  // Tipo de imagem: 'conversation' ou 'marketplace'
  imageType: {
    type: String,
    enum: ['conversation', 'marketplace', 'profile'],
    default: 'conversation',
    index: true
  },
  
  // Imagens armazenadas como base64 (solução para problema de serialização de Buffer no MongoDB Atlas)
  fullImage: {
    type: String,
    required: true
  },
  
  thumbImage: {
    type: String,
    required: true
  },
  
  fullImageJpeg: {
    type: String,
    required: true
  },
  
  thumbImageJpeg: {
    type: String,
    required: true
  },
  
  // Metadados
  metadata: {
    originalName: String,
    originalSize: Number,
    originalMimeType: String,
    width: Number,
    height: Number,
    conversationId: String,
    userId: String
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

// Métodos estáticos para conversão Buffer ↔ Base64
uploadedImageSchema.statics.bufferToBase64 = function(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  return buffer.toString('base64');
};

uploadedImageSchema.statics.base64ToBuffer = function(base64String) {
  if (!base64String || typeof base64String !== 'string') return null;
  return Buffer.from(base64String, 'base64');
};

// Método para criar imagem a partir de buffers (converte automaticamente)
uploadedImageSchema.statics.createFromBuffers = async function(data) {
  const imageData = {
    ...data,
    fullImage: this.bufferToBase64(data.fullImage),
    thumbImage: this.bufferToBase64(data.thumbImage),
    fullImageJpeg: this.bufferToBase64(data.fullImageJpeg),
    thumbImageJpeg: this.bufferToBase64(data.thumbImageJpeg)
  };
  
  return this.create(imageData);
};

// Método de instância para obter buffer específico
uploadedImageSchema.methods.getBuffer = function(type) {
  const base64 = this[type];
  return UploadedImage.base64ToBuffer(base64);
};

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

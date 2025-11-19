const mongoose = require('mongoose');

/**
 * VERSÃO 2: Armazena imagens como base64 string em vez de Buffer
 * Solução para problema de serialização de buffers no MongoDB Atlas
 */

const uploadedImageV2Schema = new mongoose.Schema({
  imageId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  conversationId: {
    type: String,
    required: false,
    index: true,
    sparse: true
  },
  
  imageType: {
    type: String,
    enum: ['conversation', 'marketplace'],
    default: 'conversation',
    index: true
  },
  
  // Armazenando como base64 string em vez de Buffer
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
  
  metadata: {
    originalName: String,
    originalSize: Number,
    originalMimeType: String,
    width: Number,
    height: Number,
    conversationId: String
  },
  
  urls: {
    full: String,
    thumb: String,
    fullJpeg: String,
    thumbJpeg: String
  },
  
  uploadedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  permanent: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Índice composto
uploadedImageV2Schema.index({ conversationId: 1, uploadedAt: -1 });

// Métodos helper para conversão
uploadedImageV2Schema.statics.bufferToBase64 = function(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  return buffer.toString('base64');
};

uploadedImageV2Schema.statics.base64ToBuffer = function(base64String) {
  if (!base64String || typeof base64String !== 'string') return null;
  return Buffer.from(base64String, 'base64');
};

// Método para criar imagem a partir de buffers
uploadedImageV2Schema.statics.createFromBuffers = async function(data) {
  const imageData = {
    ...data,
    fullImage: this.bufferToBase64(data.fullImage),
    thumbImage: this.bufferToBase64(data.thumbImage),
    fullImageJpeg: this.bufferToBase64(data.fullImageJpeg),
    thumbImageJpeg: this.bufferToBase64(data.thumbImageJpeg)
  };
  
  return this.create(imageData);
};

// Método para obter buffer específico
uploadedImageV2Schema.methods.getBuffer = function(type) {
  const base64 = this[type];
  return UploadedImageV2.base64ToBuffer(base64);
};

const UploadedImageV2 = mongoose.model('UploadedImageV2', uploadedImageV2Schema);

module.exports = UploadedImageV2;

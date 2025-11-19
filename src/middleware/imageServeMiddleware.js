const UploadedImage = require('../models/UploadedImage');
const path = require('path');

/**
 * Middleware para servir imagens EXCLUSIVAMENTE do banco de dados
 * Sistema de arquivos é efêmero no Vercel/serverless
 * Mantém compatibilidade total com URLs existentes
 * Suporta imagens de conversação e marketplace
 */
const imageServeMiddleware = async (req, res, next) => {
  try {
    // Extrair informações da URL
    // Exemplo: /uploads/conversationId/2024/1/12345_abc.avif (conversa)
    // Exemplo: /uploads/marketplace/2025/10/12345_abc.avif (marketplace)
    const urlPath = req.path;
    
    // Verificar se é uma requisição de imagem
    if (!urlPath.match(/\.(avif|jpg|jpeg|png)$/i)) {
      return next();
    }

    // Extrair o imageId da URL
    const fileName = path.basename(urlPath);
    const match = fileName.match(/^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i);
    
    if (!match) {
      return next();
    }

    const imageId = match[1];
    const isThumb = fileName.includes('_thumb');
    const isJpeg = fileName.match(/\.jpe?g$/i);

    const uploadedImage = await UploadedImage.findOne({ imageId }).lean();
    
    if (uploadedImage) {
      // Determinar qual base64 string usar e converter para Buffer
      let base64String;
      let contentType;
      
      if (isThumb) {
        if (isJpeg) {
          base64String = uploadedImage.thumbImageJpeg;
          contentType = 'image/jpeg';
        } else {
          base64String = uploadedImage.thumbImage;
          contentType = 'image/avif';
        }
      } else {
        if (isJpeg) {
          base64String = uploadedImage.fullImageJpeg;
          contentType = 'image/jpeg';
        } else {
          base64String = uploadedImage.fullImage;
          contentType = 'image/avif';
        }
      }

      // Verificar se a string base64 existe e converter para buffer
      if (!base64String || typeof base64String !== 'string' || base64String.length === 0) {
        return next(); // Tentar buscar no disco
      }

      // Converter base64 para Buffer
      const buffer = UploadedImage.base64ToBuffer(base64String);
      
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        return next(); // Tentar buscar no disco
      }

      // Garantir que buffer.length seja um número válido
      const bufferSize = Number(buffer.length);
      if (!bufferSize || isNaN(bufferSize)) {
        return next(); // Tentar buscar no disco
      }

      // Headers de cache agressivo
      res.set({
        'Content-Type': contentType,
        'Content-Length': String(bufferSize), // Converter para string explicitamente
        'Cache-Control': 'public, max-age=31536000, immutable', // 1 ano
        'ETag': `"${imageId}"`,
        'Last-Modified': uploadedImage.uploadedAt.toUTCString(),
        'Content-Disposition': 'inline',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Access-Control-Allow-Origin': '*'
      });

      return res.send(buffer);
    }

    // Imagem não encontrada no banco, passar para o próximo middleware (express.static)
    return next();
    
  } catch (error) {
    next();
  }
};

module.exports = imageServeMiddleware;

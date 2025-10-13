const UploadedImage = require('../models/UploadedImage');
const path = require('path');

/**
 * Middleware para servir imagens do banco de dados primeiro, depois do disco
 * Mantém compatibilidade total com URLs existentes
 */
const imageServeMiddleware = async (req, res, next) => {
  try {
    // Extrair informações da URL
    // Exemplo: /uploads/conversationId/2024/1/12345_abc.avif
    // Exemplo: /uploads/conversationId/2024/1/12345_abc_thumb.jpg
    const urlPath = req.path;
    
    // Verificar se é uma requisição de imagem
    if (!urlPath.match(/\.(avif|jpg|jpeg|png)$/i)) {
      return next();
    }

    // Extrair o imageId da URL
    const fileName = path.basename(urlPath);
    const match = fileName.match(/^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i);
    
    if (!match) {
      return next(); // Formato não reconhecido, deixa o static handle
    }

    const imageId = match[1];
    const isThumb = fileName.includes('_thumb');
    const isJpeg = fileName.match(/\.jpe?g$/i);

    // Tentar buscar no banco de dados
    const uploadedImage = await UploadedImage.findOne({ imageId }).lean();
    
    if (uploadedImage) {
      // Determinar qual buffer servir
      let buffer;
      let contentType;
      
      if (isThumb) {
        if (isJpeg) {
          buffer = uploadedImage.thumbImageJpeg;
          contentType = 'image/jpeg';
        } else {
          buffer = uploadedImage.thumbImage;
          contentType = 'image/avif';
        }
      } else {
        if (isJpeg) {
          buffer = uploadedImage.fullImageJpeg;
          contentType = 'image/jpeg';
        } else {
          buffer = uploadedImage.fullImage;
          contentType = 'image/avif';
        }
      }

      // Verificar se o buffer existe
      if (!buffer || buffer.length === 0) {
        console.warn('[IMAGE_SERVE] Buffer vazio no banco de dados:', imageId);
        return next(); // Tentar buscar no disco
      }

      // Headers de cache agressivo
      res.set({
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=31536000, immutable', // 1 ano
        'ETag': `"${imageId}"`,
        'Last-Modified': uploadedImage.uploadedAt.toUTCString(),
        'Content-Disposition': 'inline',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Access-Control-Allow-Origin': '*'
      });

      console.log('[IMAGE_SERVE] Servindo do banco de dados:', imageId, `(${(buffer.length / 1024).toFixed(2)}KB)`);
      return res.send(buffer);
    }

    // Se não encontrou no banco, deixa o express.static servir do disco
    console.log('[IMAGE_SERVE] Não encontrado no BD, tentando disco:', imageId);
    next();
    
  } catch (error) {
    console.error('[IMAGE_SERVE] Erro ao servir imagem:', error.message);
    // Em caso de erro, tenta servir do disco
    next();
  }
};

module.exports = imageServeMiddleware;

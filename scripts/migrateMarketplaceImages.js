require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script de migração para importar imagens de marketplace do disco para o MongoDB
 * Garante que todas as imagens sejam persistidas permanentemente
 */

async function findAllImages(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      fileList = await findAllImages(filePath, fileList);
    } else if (file.match(/\.(avif|jpg|jpeg|png)$/i)) {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

async function migrateMarketplaceImages() {
  try {
    
    await mongoose.connect(process.env.MONGODB_URI);
    
    
    const uploadsRoot = path.join(__dirname, '..', 'uploads', 'marketplace');
    
    if (!fs.existsSync(uploadsRoot)) {
      
      
      return;
    }
    
    
    const allImages = await findAllImages(uploadsRoot);
    
    
    
    let processed = 0;
    let alreadyExists = 0;
    let imported = 0;
    let errors = 0;
    
    for (const imagePath of allImages) {
      try {
        const fileName = path.basename(imagePath);
        
        // Extrair imageId (remover _thumb e extensão)
        const match = fileName.match(/^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i);
        
        if (!match) {
          
          continue;
        }
        
        const imageId = match[1];
        const isThumb = fileName.includes('_thumb');
        const isJpeg = fileName.match(/\.jpe?g$/i);
        
        // Verificar se já existe no banco
        const existing = await UploadedImage.findOne({ imageId });
        
        if (existing) {
          alreadyExists++;
          processed++;
          continue;
        }
        
        // Se for thumb ou jpeg, precisa achar os outros arquivos
        if (isThumb || isJpeg) {
          // Pula, vamos processar apenas quando encontrarmos o arquivo full.avif
          continue;
        }
        
        // Agora temos o arquivo full.avif, vamos buscar as outras variantes
        const dir = path.dirname(imagePath);
        const fullAvifPath = path.join(dir, `${imageId}.avif`);
        const thumbAvifPath = path.join(dir, `${imageId}_thumb.avif`);
        const fullJpegPath = path.join(dir, `${imageId}.jpg`);
        const thumbJpegPath = path.join(dir, `${imageId}_thumb.jpg`);
        
        // Verificar se todos os arquivos existem
        if (!fs.existsSync(fullAvifPath)) {
          
          continue;
        }
        
        // Ler buffers
        const fullImage = fs.readFileSync(fullAvifPath);
        const thumbImage = fs.existsSync(thumbAvifPath) ? fs.readFileSync(thumbAvifPath) : fullImage;
        const fullImageJpeg = fs.existsSync(fullJpegPath) ? fs.readFileSync(fullJpegPath) : fullImage;
        const thumbImageJpeg = fs.existsSync(thumbJpegPath) ? fs.readFileSync(thumbJpegPath) : thumbImage;
        
        // Extrair informações da URL
        const relativePath = path.relative(path.join(__dirname, '..', 'uploads'), imagePath);
        const publicUrl = `/uploads/${relativePath.replace(/\\/g, '/')}`;
        
        // Criar documento no banco
        await UploadedImage.create({
          imageId: imageId,
          conversationId: null, // Marketplace images não têm conversationId
          imageType: 'marketplace',
          fullImage: fullImage,
          thumbImage: thumbImage,
          fullImageJpeg: fullImageJpeg,
          thumbImageJpeg: thumbImageJpeg,
          metadata: {
            originalName: fileName,
            originalSize: fullImage.length,
            originalMimeType: 'image/avif',
          },
          urls: {
            full: publicUrl.replace(fileName, `${imageId}.avif`),
            thumb: publicUrl.replace(fileName, `${imageId}_thumb.avif`),
            fullJpeg: publicUrl.replace(fileName, `${imageId}.jpg`),
            thumbJpeg: publicUrl.replace(fileName, `${imageId}_thumb.jpg`)
          },
          uploadedBy: null,
          permanent: true
        });
        
        imported++;
        .toFixed(2)}KB)`);
        
      } catch (error) {
        errors++;
        }:`, error.message);
      }
      
      processed++;
      
      // Progress indicator
      if (processed % 10 === 0) {
        
      }
    }
    
    );
    
    );
    
    
    
    
    
    );
    
    
  } catch (error) {
    
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    
  }
}

// Executar migração
migrateMarketplaceImages()
  .then(() => {
    
    process.exit(0);
  })
  .catch((error) => {
    
    process.exit(1);
  });

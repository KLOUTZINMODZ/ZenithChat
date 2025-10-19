require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script para migrar imagens do disco para MongoDB
 * Essencial para ambientes serverless como Vercel onde o disco é efêmero
 */

async function migrateImages() {
  try {
    

    // Conectar ao MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    
    if (!fs.existsSync(uploadsDir)) {
      
      return;
    }

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    // Função recursiva para varrer diretórios
    async function processDirectory(dir, basePath = '') {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          await processDirectory(fullPath, path.join(basePath, item));
        } else if (stat.isFile()) {
          // Processar apenas arquivos AVIF/JPG principais (não thumbs)
          const match = item.match(/^(\d+_[a-z0-9]+)\.(avif|jpg)$/i);
          
          if (match && !item.includes('_thumb')) {
            const imageId = match[1];
            const ext = match[2].toLowerCase();
            
            // Verificar se já existe no banco
            const existing = await UploadedImage.findOne({ imageId });
            
            if (existing) {
              
              skipped++;
              continue;
            }
            
            try {
              // Ler todos os arquivos relacionados
              const fullAvifPath = path.join(dir, `${imageId}.avif`);
              const thumbAvifPath = path.join(dir, `${imageId}_thumb.avif`);
              const fullJpegPath = path.join(dir, `${imageId}.jpg`);
              const thumbJpegPath = path.join(dir, `${imageId}_thumb.jpg`);
              
              if (!fs.existsSync(fullAvifPath) || !fs.existsSync(thumbAvifPath) ||
                  !fs.existsSync(fullJpegPath) || !fs.existsSync(thumbJpegPath)) {
                
                errors++;
                continue;
              }
              
              const fullImage = fs.readFileSync(fullAvifPath);
              const thumbImage = fs.readFileSync(thumbAvifPath);
              const fullImageJpeg = fs.readFileSync(fullJpegPath);
              const thumbImageJpeg = fs.readFileSync(thumbJpegPath);
              
              // Determinar tipo de imagem (marketplace ou conversation)
              const isMarketplace = basePath.includes('marketplace');
              const conversationId = isMarketplace ? null : basePath.split(path.sep)[0];
              
              // URLs públicas
              const urlBase = `/uploads/${basePath.replace(/\\/g, '/')}`;
              
              // Salvar no MongoDB
              await UploadedImage.create({
                imageId,
                conversationId,
                imageType: isMarketplace ? 'marketplace' : 'conversation',
                fullImage,
                thumbImage,
                fullImageJpeg,
                thumbImageJpeg,
                metadata: {
                  originalName: item,
                  originalSize: fullImage.length,
                  originalMimeType: ext === 'avif' ? 'image/avif' : 'image/jpeg',
                  migratedFromDisk: true
                },
                urls: {
                  full: `${urlBase}/${imageId}.avif`,
                  thumb: `${urlBase}/${imageId}_thumb.avif`,
                  fullJpeg: `${urlBase}/${imageId}.jpg`,
                  thumbJpeg: `${urlBase}/${imageId}_thumb.jpg`
                },
                permanent: true,
                uploadedAt: stat.mtime // Usar data de modificação do arquivo
              });
              
              }KB)`);
              migrated++;
              
            } catch (error) {
              
              errors++;
            }
          }
        }
      }
    }
    
    await processDirectory(uploadsDir);
    
    
    
    : ${skipped}`);
    
    
    // Verificar total no banco
    const total = await UploadedImage.countDocuments();
    
    
  } catch (error) {
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

migrateImages();

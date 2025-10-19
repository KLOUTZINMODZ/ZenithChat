require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script para limpar TODAS as imagens corrompidas (com base64 inválido)
 */

async function cleanAllCorrupted() {
  try {
    
    );
    
    await mongoose.connect(process.env.MONGODB_URI);
    

    const allImages = await UploadedImage.find({}).lean();
    

    
    
    let deleted = 0;
    const toDelete = [];
    
    for (const img of allImages) {
      // Verificar se as strings base64 são válidas
      const fullImageValid = img.fullImage && typeof img.fullImage === 'string' && img.fullImage.length > 0;
      const thumbImageValid = img.thumbImage && typeof img.thumbImage === 'string' && img.thumbImage.length > 0;
      const fullJpegValid = img.fullImageJpeg && typeof img.fullImageJpeg === 'string' && img.fullImageJpeg.length > 0;
      const thumbJpegValid = img.thumbImageJpeg && typeof img.thumbImageJpeg === 'string' && img.thumbImageJpeg.length > 0;
      
      const isCorrupted = !fullImageValid || !thumbImageValid || !fullJpegValid || !thumbJpegValid;
      
      if (isCorrupted) {
        toDelete.push(img.imageId);
      }
    }

    
    
    if (toDelete.length === 0) {
      
      return;
    }

    
    
    

    for (const imageId of toDelete) {
      await UploadedImage.deleteOne({ imageId });
      
      deleted++;
    }

    const remaining = await UploadedImage.countDocuments();
    
    
    );
    
    
    
    
    
    

  } catch (error) {
    
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

cleanAllCorrupted();

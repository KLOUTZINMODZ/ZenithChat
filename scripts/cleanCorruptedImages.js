require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script para remover imagens corrompidas (buffers vazios) do MongoDB
 */

async function cleanCorruptedImages() {
  try {
    

    await mongoose.connect(process.env.MONGODB_URI);
    

    const images = await UploadedImage.find({}).lean();
    
    

    let deleted = 0;
    const corruptedIds = [];

    for (const img of images) {
      // Verificar se buffers existem e não estão vazios
      const fullImageValid = img.fullImage && Buffer.isBuffer(img.fullImage) && img.fullImage.length > 0;
      const thumbImageValid = img.thumbImage && Buffer.isBuffer(img.thumbImage) && img.thumbImage.length > 0;
      const fullJpegValid = img.fullImageJpeg && Buffer.isBuffer(img.fullImageJpeg) && img.fullImageJpeg.length > 0;
      const thumbJpegValid = img.thumbImageJpeg && Buffer.isBuffer(img.thumbImageJpeg) && img.thumbImageJpeg.length > 0;

      const isCorrupted = !fullImageValid || !thumbImageValid || !fullJpegValid || !thumbJpegValid;

      if (isCorrupted) {
        corruptedIds.push(img.imageId);
        await UploadedImage.deleteOne({ _id: img._id });
        
        deleted++;
      }
    }

    
    
    
    
    const remaining = await UploadedImage.countDocuments();
    

    if (deleted > 0) {
      .');
      
    }

  } catch (error) {
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

cleanCorruptedImages();

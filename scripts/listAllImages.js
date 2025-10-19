require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');

/**
 * Script para listar todas as imagens e encontrar uma específica
 */

async function listAllImages() {
  
  );
  
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    

    // Estatísticas gerais
    const total = await UploadedImage.countDocuments();
    const marketplace = await UploadedImage.countDocuments({ imageType: 'marketplace' });
    const conversation = await UploadedImage.countDocuments({ imageType: 'conversation' });
    
    
    );
    
    
    

    // Listar imagens de marketplace (mais recentes primeiro)
    ');
    );
    
    const marketplaceImages = await UploadedImage.find({ imageType: 'marketplace' })
      .sort({ uploadedAt: -1 })
      .limit(10)
      .select('imageId urls.full uploadedAt metadata.originalName')
      .lean();
    
    if (marketplaceImages.length === 0) {
      
    } else {
      marketplaceImages.forEach((img, index) => {
        
        
        
        .toLocaleString('pt-BR')}`);
      });
    }

    // Buscar imagem específica do erro
    const targetImageId = '1760889095249_ve5m4a7ykn';
    
    );
    
    const specificImage = await UploadedImage.findOne({ imageId: targetImageId }).lean();
    
    if (!specificImage) {
      
      
      // Buscar imagens com ID parcial similar
      const partialId = targetImageId.substring(0, 10);
      const similar = await UploadedImage.find({
        imageId: new RegExp(partialId, 'i')
      }).select('imageId uploadedAt').lean();
      
      if (similar.length > 0) {
        :`);
        similar.forEach(img => {
          .toLocaleString('pt-BR')})`);
        });
      } else {
        
      }
      
    } else {
      
      
      
      
      
      
      .toLocaleString('pt-BR')}`);
      
      
      if (specificImage.urls) {
        
        
        
        
        
      }
      
      if (specificImage.metadata) {
        
        
        .toFixed(2)} KB`);
        
        
      }
      
      
      const base64Checks = {
        fullImage: specificImage.fullImage,
        thumbImage: specificImage.thumbImage,
        fullImageJpeg: specificImage.fullImageJpeg,
        thumbImageJpeg: specificImage.thumbImageJpeg
      };
      
      for (const [name, base64] of Object.entries(base64Checks)) {
        const isValid = base64 && typeof base64 === 'string' && base64.length > 0;
        
      }
    }

    // Buscar imagens corrompidas
    
    );
    
    const allImages = await UploadedImage.find({}).select('imageId fullImage').lean();
    const corrupted = allImages.filter(img => 
      !img.fullImage || typeof img.fullImage !== 'string' || img.fullImage.length === 0
    );
    
    if (corrupted.length > 0) {
      
      corrupted.slice(0, 10).forEach(img => {
        
      });
      if (corrupted.length > 10) {
        
      }
      
    } else {
      
    }

  } catch (error) {
    
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

listAllImages();

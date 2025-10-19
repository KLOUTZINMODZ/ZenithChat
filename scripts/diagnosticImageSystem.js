require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');
const path = require('path');
const fs = require('fs');

/**
 * Script de Diagnóstico Completo do Sistema de Imagens
 * Verifica toda a cadeia: upload → armazenamento → recuperação
 */

const testImageUrl = 'https://zenith.enrelyugi.com.br/uploads/marketplace/2025/10/1760889095249_ve5m4a7ykn.avif';

async function diagnosticImageSystem() {
  
  );
  
  try {
    // 1. CONECTAR AO MONGODB
    
    );
    await mongoose.connect(process.env.MONGODB_URI);
    
    
    

    // 2. EXTRAIR INFORMAÇÕES DA URL
    
    );
    
    
    const urlPath = new URL(testImageUrl).pathname;
    
    
    // Extrair imageId
    const fileName = path.basename(urlPath);
    
    
    const match = fileName.match(/^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i);
    if (!match) {
      
      
      
      return;
    }
    
    const imageId = match[1];
    
    
    const isThumb = fileName.includes('_thumb');
    const isJpeg = fileName.match(/\.jpe?g$/i);
    
    '}`);

    // 3. VERIFICAR NO BANCO DE DADOS
    
    );
    
    const dbImage = await UploadedImage.findOne({ imageId }).lean();
    
    if (!dbImage) {
      
      
      
      // Listar imagens similares
      const similar = await UploadedImage.find({
        imageId: new RegExp(imageId.substring(0, 10), 'i')
      }).limit(5).select('imageId imageType uploadedAt').lean();
      
      if (similar.length > 0) {
        
        similar.forEach(img => {
          - ${new Date(img.uploadedAt).toLocaleString('pt-BR')}`);
        });
      }
      
      // Estatísticas gerais
      const totalImages = await UploadedImage.countDocuments();
      const marketplaceImages = await UploadedImage.countDocuments({ imageType: 'marketplace' });
      const conversationImages = await UploadedImage.countDocuments({ imageType: 'conversation' });
      
      
      
      
      
      
    } else {
      
      
      
      .toLocaleString('pt-BR')}`);
      
      
      // Verificar buffers
      
      const buffers = {
        fullImage: dbImage.fullImage,
        thumbImage: dbImage.thumbImage,
        fullImageJpeg: dbImage.fullImageJpeg,
        thumbImageJpeg: dbImage.thumbImageJpeg
      };
      
      for (const [name, buffer] of Object.entries(buffers)) {
        const exists = buffer && Buffer.isBuffer(buffer);
        const size = exists ? buffer.length : 0;
        const sizeKb = (size / 1024).toFixed(2);
        
        if (exists && size > 0) {
          
        } else {
          
        }
      }
      
      // Verificar qual buffer deve ser servido
      const bufferToServe = isThumb 
        ? (isJpeg ? dbImage.thumbImageJpeg : dbImage.thumbImage)
        : (isJpeg ? dbImage.fullImageJpeg : dbImage.fullImage);
      
      const bufferName = isThumb 
        ? (isJpeg ? 'thumbImageJpeg' : 'thumbImage')
        : (isJpeg ? 'fullImageJpeg' : 'fullImage');
      
      
      
      if (bufferToServe && Buffer.isBuffer(bufferToServe) && bufferToServe.length > 0) {
        .toFixed(2)} KB`);
      } else {
        
      }
      
      // URLs armazenadas
      if (dbImage.urls) {
        
        
        
        
        
      }
      
      // Metadados
      if (dbImage.metadata) {
        
        
        .toFixed(2) + ' KB' : 'N/A'}`);
        
        
      }
    }

    // 4. VERIFICAR NO DISCO
    
    );
    
    const diskPath = path.join(__dirname, '..', 'uploads', 'marketplace', '2025', '10', fileName);
    
    
    if (fs.existsSync(diskPath)) {
      const stats = fs.statSync(diskPath);
      
      .toFixed(2)} KB`);
      }`);
    } else {
      
      
    }

    // 5. TESTAR REGEX DO MIDDLEWARE
    
    );
    
    const regexTests = [
      { pattern: /\.(avif|jpg|jpeg|png)$/i, name: 'Extensão válida' },
      { pattern: /^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i, name: 'Padrão de nome' }
    ];
    
    regexTests.forEach(test => {
      const matches = fileName.match(test.pattern);
      
      if (matches && matches[1]) {
        
      }
    });

    // 6. RESUMO E DIAGNÓSTICO
    
    );
    
    if (!dbImage) {
      
      
      
      
      
      
      
      
      
      ');
      
    } else {
      const bufferToServe = isThumb 
        ? (isJpeg ? dbImage.thumbImageJpeg : dbImage.thumbImage)
        : (isJpeg ? dbImage.fullImageJpeg : dbImage.fullImage);
      
      if (bufferToServe && Buffer.isBuffer(bufferToServe) && bufferToServe.length > 0) {
        
        
        
        
        
        
        
      } else {
        
        
        
        
        
        
        
        ');
        
      }
    }

  } catch (error) {
    
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

diagnosticImageSystem();

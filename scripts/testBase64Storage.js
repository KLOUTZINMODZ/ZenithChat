require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImageV2 = require('../src/models/UploadedImageV2');
const sharp = require('sharp');

/**
 * Teste de armazenamento usando base64 em vez de Buffer
 */

async function testBase64Storage() {
  
  );
  
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    

    // TESTE 1: Buffer simples para base64
    
    );
    
    const originalBuffer = Buffer.alloc(1024, 'X');
    
    
    const base64 = UploadedImageV2.bufferToBase64(originalBuffer);
    
    
    const recoveredBuffer = UploadedImageV2.base64ToBuffer(base64);
    
    
    const identical = originalBuffer.equals(recoveredBuffer);
    

    // TESTE 2: Imagem real com Sharp
    ');
    );
    
    const testImage = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 255, g: 0, b: 255, alpha: 1 }
      }
    })
    .png()
    .toBuffer();
    
    .toFixed(2)} KB`);

    const image = sharp(testImage);
    const fullBuffer = await image.clone().avif({ quality: 45 }).toBuffer();
    const thumbBuffer = await image.clone().resize(512, 512).avif({ quality: 40 }).toBuffer();
    const fullJpegBuffer = await image.clone().jpeg({ quality: 80 }).toBuffer();
    const thumbJpegBuffer = await image.clone().resize(512, 512).jpeg({ quality: 78 }).toBuffer();
    
    .toFixed(2)} KB`);
    .toFixed(2)} KB`);
    .toFixed(2)} KB`);
    .toFixed(2)} KB`);

    // TESTE 3: Salvar no MongoDB usando base64
    ');
    );
    
    const now = new Date();
    const baseName = `testb64_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    const savedImage = await UploadedImageV2.createFromBuffers({
      imageId: baseName,
      conversationId: null,
      imageType: 'marketplace',
      fullImage: fullBuffer,
      thumbImage: thumbBuffer,
      fullImageJpeg: fullJpegBuffer,
      thumbImageJpeg: thumbJpegBuffer,
      metadata: {
        originalName: 'test-base64.png',
        originalSize: testImage.length,
        originalMimeType: 'image/png',
        width: 500,
        height: 500
      },
      urls: {
        full: `/uploads/marketplace/${now.getFullYear()}/${now.getMonth() + 1}/${baseName}.avif`,
        thumb: `/uploads/marketplace/${now.getFullYear()}/${now.getMonth() + 1}/${baseName}_thumb.avif`,
        fullJpeg: `/uploads/marketplace/${now.getFullYear()}/${now.getMonth() + 1}/${baseName}.jpg`,
        thumbJpeg: `/uploads/marketplace/${now.getFullYear()}/${now.getMonth() + 1}/${baseName}_thumb.jpg`
      },
      permanent: true
    });
    
    
    

    // TESTE 4: Recuperar e validar
    
    );
    
    const retrieved = await UploadedImageV2.findOne({ imageId: baseName }).lean();
    
    if (!retrieved) {
      
      return;
    }
    
    
    
    // Verificar strings base64
    const checks = {
      fullImage: retrieved.fullImage,
      thumbImage: retrieved.thumbImage,
      fullImageJpeg: retrieved.fullImageJpeg,
      thumbImageJpeg: retrieved.thumbImageJpeg
    };
    
    
    for (const [name, base64] of Object.entries(checks)) {
      const isValid = base64 && typeof base64 === 'string' && base64.length > 0;
      
    }

    // TESTE 5: Converter de volta para Buffer
    
    );
    
    const buffers = {
      fullImage: UploadedImageV2.base64ToBuffer(retrieved.fullImage),
      thumbImage: UploadedImageV2.base64ToBuffer(retrieved.thumbImage),
      fullImageJpeg: UploadedImageV2.base64ToBuffer(retrieved.fullImageJpeg),
      thumbImageJpeg: UploadedImageV2.base64ToBuffer(retrieved.thumbImageJpeg)
    };
    
    let allValid = true;
    for (const [name, buffer] of Object.entries(buffers)) {
      const isValid = buffer && Buffer.isBuffer(buffer) && buffer.length > 0;
      const size = isValid ? (buffer.length / 1024).toFixed(2) : 0;
      
      if (!isValid) allValid = false;
    }

    // TESTE 6: Comparar com originais
    
    );
    
    const comparisons = {
      fullImage: fullBuffer.equals(buffers.fullImage),
      thumbImage: thumbBuffer.equals(buffers.thumbImage),
      fullImageJpeg: fullJpegBuffer.equals(buffers.fullImageJpeg),
      thumbImageJpeg: thumbJpegBuffer.equals(buffers.thumbImageJpeg)
    };
    
    for (const [name, identical] of Object.entries(comparisons)) {
      
    }

    // TESTE 7: Tamanho do documento
    
    );
    
    const docSize = JSON.stringify(retrieved).length;
    const maxSize = 16 * 1024 * 1024;
    const percentage = ((docSize / maxSize) * 100).toFixed(2);
    
    .toFixed(2)} KB`);
    .toFixed(2)} MB`);
    
    

    // RESUMO
    
    );
    
    if (allValid) {
      
      
      
      
      
      
      
      ');
    } else {
      
    }

    // Limpar teste
    
    await UploadedImageV2.deleteOne({ imageId: baseName });
    

  } catch (error) {
    
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

testBase64Storage();

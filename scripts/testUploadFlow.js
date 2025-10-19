require('dotenv').config();
const mongoose = require('mongoose');
const UploadedImage = require('../src/models/UploadedImage');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * Script para testar o fluxo completo de upload de imagens
 * Simula o processo que acontece no uploadRoutes.js
 */

async function testUploadFlow() {
  
  );
  
  try {
    // 1. CONECTAR AO MONGODB
    
    );
    await mongoose.connect(process.env.MONGODB_URI);
    

    // 2. CRIAR IMAGEM DE TESTE
    
    );
    
    // Criar uma imagem simples de 500x500 pixels
    const testImageBuffer = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 138, g: 43, b: 226, alpha: 1 } // roxo
      }
    })
    .png()
    .toBuffer();
    
    .toFixed(2)} KB`);

    // 3. PROCESSAR IMAGEM (como no uploadRoutes.js)
    
    );
    
    const image = sharp(testImageBuffer, { failOnError: false });
    const metadata = await image.metadata();
    
    
    

    // Criar versões processadas
    
    
    const fullBuffer = await image.clone()
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 45 })
      .toBuffer();
    .toFixed(2)} KB`);

    const fullJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, mozjpeg: true })
      .toBuffer();
    .toFixed(2)} KB`);

    const thumbBuffer = await image.clone()
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 40 })
      .toBuffer();
    .toFixed(2)} KB`);

    const thumbJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, progressive: true, mozjpeg: true })
      .toBuffer();
    .toFixed(2)} KB`);

    // 4. VALIDAR BUFFERS
    
    );
    
    const buffers = {
      fullBuffer,
      thumbBuffer,
      fullJpegBuffer,
      thumbJpegBuffer
    };
    
    let allValid = true;
    for (const [name, buffer] of Object.entries(buffers)) {
      const isValid = buffer && Buffer.isBuffer(buffer) && buffer.length > 0;
      
      if (!isValid) allValid = false;
    }
    
    if (!allValid) {
      
      return;
    }

    // 5. CRIAR DOCUMENTO NO MONGODB
    
    );
    
    const now = new Date();
    const subPath = `marketplace/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}`;
    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    const publicFull = `/uploads/${subPath}/${baseName}.avif`;
    const publicThumb = `/uploads/${subPath}/${baseName}_thumb.avif`;
    const publicFullJpeg = `/uploads/${subPath}/${baseName}.jpg`;
    const publicThumbJpeg = `/uploads/${subPath}/${baseName}_thumb.jpg`;
    
    
    
    

    const savedImage = await UploadedImage.createFromBuffers({
      imageId: baseName,
      conversationId: null,
      imageType: 'marketplace',
      fullImage: fullBuffer,
      thumbImage: thumbBuffer,
      fullImageJpeg: fullJpegBuffer,
      thumbImageJpeg: thumbJpegBuffer,
      metadata: {
        originalName: 'test-image.png',
        originalSize: testImageBuffer.length,
        originalMimeType: 'image/png',
        width: metadata.width,
        height: metadata.height
      },
      urls: {
        full: publicFull,
        thumb: publicThumb,
        fullJpeg: publicFullJpeg,
        thumbJpeg: publicThumbJpeg
      },
      permanent: true
    });

    if (!savedImage || !savedImage.imageId) {
      
      return;
    }

    
    

    // 6. VERIFICAR SE FOI SALVO CORRETAMENTE
    
    );
    
    const retrieved = await UploadedImage.findOne({ imageId: baseName }).lean();
    
    if (!retrieved) {
      
      return;
    }
    
    
    
    // Verificar strings base64 recuperadas
    const retrievedBase64 = {
      fullImage: retrieved.fullImage,
      thumbImage: retrieved.thumbImage,
      fullImageJpeg: retrieved.fullImageJpeg,
      thumbImageJpeg: retrieved.thumbImageJpeg
    };
    
    let allRetrievedValid = true;
    
    for (const [name, base64] of Object.entries(retrievedBase64)) {
      const isValid = base64 && typeof base64 === 'string' && base64.length > 0;
      
      if (!isValid) allRetrievedValid = false;
    }
    
    // Converter base64 para buffers e verificar
    
    const retrievedBuffers = {
      fullImage: UploadedImage.base64ToBuffer(retrieved.fullImage),
      thumbImage: UploadedImage.base64ToBuffer(retrieved.thumbImage),
      fullImageJpeg: UploadedImage.base64ToBuffer(retrieved.fullImageJpeg),
      thumbImageJpeg: UploadedImage.base64ToBuffer(retrieved.thumbImageJpeg)
    };
    
    for (const [name, buffer] of Object.entries(retrievedBuffers)) {
      const isValid = buffer && Buffer.isBuffer(buffer) && buffer.length > 0;
      const size = isValid ? (buffer.length / 1024).toFixed(2) : 0;
      
      if (!isValid) allRetrievedValid = false;
    }

    // 7. SIMULAR ACESSO VIA MIDDLEWARE
    
    );
    
    const testUrl = publicFull;
    const fileName = path.basename(testUrl);
    
    
    
    const match = fileName.match(/^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i);
    if (!match) {
      
      return;
    }
    
    const imageId = match[1];
    
    
    const foundByMiddleware = await UploadedImage.findOne({ imageId }).lean();
    if (!foundByMiddleware) {
      
      return;
    }
    
    
    
    // Verificar base64
    const base64ToServe = foundByMiddleware.fullImage;
    if (!base64ToServe || typeof base64ToServe !== 'string' || base64ToServe.length === 0) {
      ');
      return;
    }
    
    
    // Converter para buffer
    const bufferToServe = UploadedImage.base64ToBuffer(base64ToServe);
    if (bufferToServe && Buffer.isBuffer(bufferToServe) && bufferToServe.length > 0) {
      .toFixed(2)} KB`);
    } else {
      
      return;
    }

    // 8. RESUMO FINAL
    
    );
    
    if (allValid && allRetrievedValid) {
      
      
      
      
      
      
      `);
    } else {
      
      
    }

  } catch (error) {
    
    
  } finally {
    await mongoose.connection.close();
    
    process.exit(0);
  }
}

testUploadFlow();

const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { auth } = require('../middleware/auth');
const UploadedImage = require('../models/UploadedImage');


const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/avif']);
const MAX_FILE_SIZE = 25 * 1024 * 1024; 

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Unsupported file type. Allowed: PNG, JPG, JPEG, AVIF'));
    }
    cb(null, true);
  }
});

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

router.post('/image', auth, upload.single('file'), async (req, res) => {
  console.log('[UPLOAD] Handler start', {
    method: req.method,
    url: req.originalUrl || req.url,
    contentType: req.headers['content-type']
  });
  try {
    const { conversationId } = req.body || {};
    if (!conversationId) {
      console.warn('[UPLOAD] Missing conversationId');
      return res.status(400).json({ success: false, message: 'conversationId is required' });
    }
    if (!req.file) {
      console.warn('[UPLOAD] No file uploaded');
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const originalMime = req.file.mimetype;
    console.log('[UPLOAD] Input received', {
      conversationId,
      file: {
        name: req.file.originalname,
        size: req.file.size,
        mime: req.file.mimetype
      }
    });


    const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');
    const now = new Date();
    const subPath = path.join(conversationId.toString(), String(now.getUTCFullYear()), String(now.getUTCMonth() + 1));
    const targetDir = path.join(uploadsRoot, subPath);
    ensureDirSync(targetDir);

    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const fullPath = path.join(targetDir, `${baseName}.avif`);
    const thumbPath = path.join(targetDir, `${baseName}_thumb.avif`);
    const fullJpegPath = path.join(targetDir, `${baseName}.jpg`);
    const thumbJpegPath = path.join(targetDir, `${baseName}_thumb.jpg`);


    const image = sharp(req.file.buffer, { failOnError: false });
    const metadata = await image.metadata();


    const fullBuffer = await image.clone()
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 45 })
      .toBuffer();

    const fullJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, mozjpeg: true })
      .toBuffer();


    const thumbBuffer = await image.clone()
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 40 })
      .toBuffer();

    const thumbJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, progressive: true, mozjpeg: true })
      .toBuffer();

    // Salvar no disco (para compatibilidade com imagens antigas)
    fs.writeFileSync(fullPath, fullBuffer);
    fs.writeFileSync(thumbPath, thumbBuffer);
    fs.writeFileSync(fullJpegPath, fullJpegBuffer);
    fs.writeFileSync(thumbJpegPath, thumbJpegBuffer);

    const publicFull = `/uploads/${subPath.replace(/\\/g, '/').replace(/\+/g, '/')}/${baseName}.avif`;
    const publicThumb = `/uploads/${subPath.replace(/\\/g, '/').replace(/\+/g, '/')}/${baseName}_thumb.avif`;
    const publicFullJpeg = `/uploads/${subPath.replace(/\\/g, '/').replace(/\+/g, '/')}/${baseName}.jpg`;
    const publicThumbJpeg = `/uploads/${subPath.replace(/\\/g, '/').replace(/\+/g, '/')}/${baseName}_thumb.jpg`;

    // Salvar no banco de dados (permanente)
    try {
      await UploadedImage.create({
        imageId: baseName,
        conversationId: conversationId.toString(),
        fullImage: fullBuffer,
        thumbImage: thumbBuffer,
        fullImageJpeg: fullJpegBuffer,
        thumbImageJpeg: thumbJpegBuffer,
        metadata: {
          originalName: req.file.originalname,
          originalSize: req.file.size,
          originalMimeType: originalMime,
          width: metadata.width,
          height: metadata.height,
          conversationId: conversationId.toString()
        },
        urls: {
          full: publicFull,
          thumb: publicThumb,
          fullJpeg: publicFullJpeg,
          thumbJpeg: publicThumbJpeg
        },
        uploadedBy: req.user?._id || req.user?.id,
        permanent: true
      });
      console.log('[UPLOAD] Image saved to database:', baseName);
    } catch (dbError) {
      console.error('[UPLOAD] Error saving to database:', dbError.message);
      // Continua mesmo se falhar, pois já salvou no disco
    }

    console.log('[UPLOAD] Success', {
      conversationId,
      publicFull,
      publicThumb,
      publicFullJpeg,
      publicThumbJpeg,
      size: req.file.size
    });
    return res.status(201).json({
      success: true,
      data: {
        url: publicFull,
        thumbUrl: publicThumb,
        urlJpeg: publicFullJpeg,
        thumbUrlJpeg: publicThumbJpeg,
        name: req.file.originalname,
        size: req.file.size,
        mimeType: 'image/avif',
        originalMimeType: originalMime,
        width: metadata.width,
        height: metadata.height,
        uploadedAt: new Date().toISOString(),
        conversationId
      }
    });
  } catch (error) {
    console.error('[UPLOAD] Error', { message: error?.message, stack: error?.stack });
    return res.status(500).json({ success: false, message: error.message || 'Upload failed' });
  }
});


function decodeBase64Image(input, explicitMime) {
  if (!input || typeof input !== 'string') return { error: 'No base64 data provided' };
  try {
    if (input.startsWith('data:')) {
      const match = input.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) return { error: 'Invalid data URL format' };
      const mime = match[1];
      const b64 = match[2];
      const buffer = Buffer.from(b64, 'base64');
      return { buffer, mime };
    }
    const mime = explicitMime || 'image/jpeg';
    const buffer = Buffer.from(input, 'base64');
    return { buffer, mime };
  } catch (e) {
    return { error: 'Invalid base64 content' };
  }
}


router.post('/image-base64', auth, async (req, res) => {
  console.log('[UPLOAD:B64] Handler start', {
    method: req.method,
    url: req.originalUrl || req.url,
    contentType: req.headers['content-type']
  });
  try {
    const { conversationId, dataUrl, base64, mimeType, name } = req.body || {};
    if (!conversationId) {
      console.warn('[UPLOAD:B64] Missing conversationId');
      return res.status(400).json({ success: false, message: 'conversationId is required' });
    }

    const decoded = decodeBase64Image(dataUrl || base64, mimeType);
    if (decoded.error) {
      console.warn('[UPLOAD:B64] Decode error:', decoded.error);
      return res.status(400).json({ success: false, message: decoded.error });
    }

    const originalMime = decoded.mime;
    if (!ALLOWED_MIME.has(originalMime)) {
      return res.status(415).json({ success: false, message: 'Unsupported file type. Allowed: PNG, JPG, JPEG, AVIF' });
    }

    if (!decoded.buffer || decoded.buffer.length === 0) {
      return res.status(400).json({ success: false, message: 'Empty image data' });
    }
    if (decoded.buffer.length > MAX_FILE_SIZE) {
      return res.status(400).json({ success: false, message: 'File too large. Max 25MB' });
    }


    const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');
    const now = new Date();
    const subPath = path.join(conversationId.toString(), String(now.getUTCFullYear()), String(now.getUTCMonth() + 1));
    const targetDir = path.join(uploadsRoot, subPath);
    ensureDirSync(targetDir);

    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const fullPath = path.join(targetDir, `${baseName}.avif`);
    const thumbPath = path.join(targetDir, `${baseName}_thumb.avif`);
    const fullJpegPath = path.join(targetDir, `${baseName}.jpg`);
    const thumbJpegPath = path.join(targetDir, `${baseName}_thumb.jpg`);


    const image = sharp(decoded.buffer, { failOnError: false });
    const metadata = await image.metadata();


    const fullBuffer = await image.clone()
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 45 })
      .toBuffer();

    const fullJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, mozjpeg: true })
      .toBuffer();


    const thumbBuffer = await image.clone()
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 40 })
      .toBuffer();

    const thumbJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, progressive: true, mozjpeg: true })
      .toBuffer();

    // Salvar no disco (para compatibilidade com imagens antigas)
    fs.writeFileSync(fullPath, fullBuffer);
    fs.writeFileSync(thumbPath, thumbBuffer);
    fs.writeFileSync(fullJpegPath, fullJpegBuffer);
    fs.writeFileSync(thumbJpegPath, thumbJpegBuffer);

    const publicFull = `/uploads/${subPath.replace(/\\/g, '/').replace(/\+/g, '/')}/${baseName}.avif`;
    const publicThumb = `/uploads/${subPath.replace(/\\/g, '/').replace(/\+/g, '/')}/${baseName}_thumb.avif`;
    const publicFullJpeg = `/uploads/${subPath.replace(/\\/g, '/').replace(/\+/g, '/')}/${baseName}.jpg`;
    const publicThumbJpeg = `/uploads/${subPath.replace(/\\/g, '/').replace(/\+/g, '/')}/${baseName}_thumb.jpg`;

    // Salvar no banco de dados (permanente)
    try {
      await UploadedImage.create({
        imageId: baseName,
        conversationId: conversationId.toString(),
        fullImage: fullBuffer,
        thumbImage: thumbBuffer,
        fullImageJpeg: fullJpegBuffer,
        thumbImageJpeg: thumbJpegBuffer,
        metadata: {
          originalName: name || `image_${baseName}.avif`,
          originalSize: decoded.buffer.length,
          originalMimeType: originalMime,
          width: metadata.width,
          height: metadata.height,
          conversationId: conversationId.toString()
        },
        urls: {
          full: publicFull,
          thumb: publicThumb,
          fullJpeg: publicFullJpeg,
          thumbJpeg: publicThumbJpeg
        },
        uploadedBy: req.user?._id || req.user?.id,
        permanent: true
      });
      console.log('[UPLOAD:B64] Image saved to database:', baseName);
    } catch (dbError) {
      console.error('[UPLOAD:B64] Error saving to database:', dbError.message);
      // Continua mesmo se falhar, pois já salvou no disco
    }

    console.log('[UPLOAD:B64] Success', {
      conversationId,
      publicFull,
      publicThumb,
      publicFullJpeg,
      publicThumbJpeg,
      size: decoded.buffer.length,
      name
    });
    return res.status(201).json({
      success: true,
      data: {
        url: publicFull,
        thumbUrl: publicThumb,
        urlJpeg: publicFullJpeg,
        thumbUrlJpeg: publicThumbJpeg,
        name: name || `image_${baseName}.avif`,
        size: decoded.buffer.length,
        mimeType: 'image/avif',
        originalMimeType: originalMime,
        width: metadata.width,
        height: metadata.height,
        uploadedAt: new Date().toISOString(),
        conversationId
      }
    });
  } catch (error) {
    console.error('[UPLOAD:B64] Error', { message: error?.message, stack: error?.stack });
    return res.status(500).json({ success: false, message: error.message || 'Upload failed' });
  }
});

// Nova rota para servir imagens do banco de dados
router.get('/serve/:imageId/:variant', async (req, res) => {
  try {
    const { imageId, variant } = req.params;
    
    // Remover extensão do imageId se houver
    const cleanImageId = imageId.replace(/\.(avif|jpg|jpeg|png)$/i, '');
    
    // Buscar imagem no banco de dados
    const uploadedImage = await UploadedImage.findOne({ imageId: cleanImageId });
    
    if (uploadedImage) {
      // Determinar qual buffer servir
      let buffer;
      let contentType;
      
      if (variant === 'full.avif' || variant === 'avif') {
        buffer = uploadedImage.fullImage;
        contentType = 'image/avif';
      } else if (variant === 'thumb.avif' || variant === 'thumb_avif') {
        buffer = uploadedImage.thumbImage;
        contentType = 'image/avif';
      } else if (variant === 'full.jpg' || variant === 'jpg') {
        buffer = uploadedImage.fullImageJpeg;
        contentType = 'image/jpeg';
      } else if (variant === 'thumb.jpg' || variant === 'thumb_jpg') {
        buffer = uploadedImage.thumbImageJpeg;
        contentType = 'image/jpeg';
      } else {
        // Default para full.avif
        buffer = uploadedImage.fullImage;
        contentType = 'image/avif';
      }
      
      // Cache headers
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // 1 ano
        'ETag': `"${uploadedImage.imageId}"`,
        'Last-Modified': uploadedImage.uploadedAt.toUTCString()
      });
      
      return res.send(buffer);
    }
    
    // Fallback: tentar buscar no disco
    console.log('[SERVE] Image not found in database, trying filesystem:', cleanImageId);
    return res.status(404).json({ 
      success: false, 
      message: 'Image not found' 
    });
  } catch (error) {
    console.error('[SERVE] Error serving image:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Error serving image' 
    });
  }
});

module.exports = router;

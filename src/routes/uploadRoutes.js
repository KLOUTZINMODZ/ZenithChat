const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const { auth } = require('../middleware/auth');
const UploadedImage = require('../models/UploadedImage');
const User = require('../models/User');


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

function resolvePublicBaseUrl(req) {
  const configured = (process.env.CHAT_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  const forwardedProto = req.get('x-forwarded-proto');
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  const forwardedHost = req.get('x-forwarded-host');
  const host = forwardedHost ? forwardedHost.split(',')[0].trim() : req.get('host');
  return `${proto}://${host}`.replace(/\/$/, '');
}

function padMonth(monthZeroBased) {
  return String(monthZeroBased + 1).padStart(2, '0');
}

router.post('/image', auth, upload.single('file'), async (req, res) => {
  try {
    const { conversationId } = req.body || {};
    if (!conversationId) {
      return res.status(400).json({ success: false, message: 'conversationId is required' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const originalMime = req.file.mimetype;
    const now = new Date();
    const subPath = `${conversationId}/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}`;
    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

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

    const publicFull = `/uploads/${subPath}/${baseName}.avif`;
    const publicThumb = `/uploads/${subPath}/${baseName}_thumb.avif`;
    const publicFullJpeg = `/uploads/${subPath}/${baseName}.jpg`;
    const publicThumbJpeg = `/uploads/${subPath}/${baseName}_thumb.jpg`;

    if (!fullBuffer || !Buffer.isBuffer(fullBuffer) || fullBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid image buffer' });
    }
    if (!thumbBuffer || !Buffer.isBuffer(thumbBuffer) || thumbBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid thumbnail buffer' });
    }
    if (!fullJpegBuffer || !Buffer.isBuffer(fullJpegBuffer) || fullJpegBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid JPEG buffer' });
    }
    if (!thumbJpegBuffer || !Buffer.isBuffer(thumbJpegBuffer) || thumbJpegBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid JPEG thumbnail buffer' });
    }

    const savedImage = await UploadedImage.createFromBuffers({
      imageId: baseName,
      conversationId: conversationId.toString(),
      imageType: 'conversation',
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

    if (!savedImage || !savedImage.imageId) {
      return res.status(500).json({ success: false, message: 'Failed to save image' });
    }
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
    return res.status(500).json({ success: false, message: error.message || 'Upload failed' });
  }
});

router.post('/profile', auth, upload.single('file'), async (req, res) => {
  try {
    const userId = req.userId || req.user?._id?.toString?.();
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Unable to identify user' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const originalMime = req.file.mimetype;
    const now = new Date();
    const subPath = `profile/${now.getUTCFullYear()}/${padMonth(now.getUTCMonth())}`;
    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const image = sharp(req.file.buffer, { failOnError: false });
    const metadata = await image.metadata();

    const fullBuffer = await image.clone()
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 50 })
      .toBuffer();

    const fullJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();

    const thumbBuffer = await image.clone()
      .rotate()
      .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 45 })
      .toBuffer();

    const thumbJpegBuffer = await image.clone()
      .rotate()
      .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, mozjpeg: true })
      .toBuffer();

    if (!fullBuffer || !fullBuffer.length) {
      return res.status(500).json({ success: false, message: 'Invalid image buffer' });
    }
    if (!thumbBuffer || !thumbBuffer.length) {
      return res.status(500).json({ success: false, message: 'Invalid thumbnail buffer' });
    }
    if (!fullJpegBuffer || !fullJpegBuffer.length) {
      return res.status(500).json({ success: false, message: 'Invalid JPEG buffer' });
    }
    if (!thumbJpegBuffer || !thumbJpegBuffer.length) {
      return res.status(500).json({ success: false, message: 'Invalid JPEG thumbnail buffer' });
    }

    const fullPath = `/uploads/${subPath}/${baseName}.avif`;
    const thumbPath = `/uploads/${subPath}/${baseName}_thumb.avif`;
    const fullJpegPath = `/uploads/${subPath}/${baseName}.jpg`;
    const thumbJpegPath = `/uploads/${subPath}/${baseName}_thumb.jpg`;

    const savedImage = await UploadedImage.createFromBuffers({
      imageId: baseName,
      conversationId: null,
      userId,
      imageType: 'profile',
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
        userId
      },
      urls: {
        full: fullPath,
        thumb: thumbPath,
        fullJpeg: fullJpegPath,
        thumbJpeg: thumbJpegPath
      },
      uploadedBy: userId,
      permanent: true
    });

    if (!savedImage || !savedImage.imageId) {
      return res.status(500).json({ success: false, message: 'Failed to save image' });
    }

    const baseUrl = resolvePublicBaseUrl(req);
    const fullUrl = `${baseUrl}${fullPath}`;
    const thumbUrl = `${baseUrl}${thumbPath}`;
    const fullJpegUrl = `${baseUrl}${fullJpegPath}`;
    const thumbJpegUrl = `${baseUrl}${thumbJpegPath}`;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        avatar: fullUrl,
        profileImage: fullUrl,
        updatedAt: new Date()
      },
      { new: true }
    ).select('name email avatar profileImage');

    return res.status(201).json({
      success: true,
      data: {
        url: fullUrl,
        path: fullPath,
        thumbUrl,
        urlJpeg: fullJpegUrl,
        thumbUrlJpeg: thumbJpegUrl,
        name: req.file.originalname,
        size: req.file.size,
        mimeType: 'image/avif',
        originalMimeType: originalMime,
        width: metadata.width,
        height: metadata.height,
        uploadedAt: new Date().toISOString(),
        user: updatedUser
      }
    });
  } catch (error) {
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
  try {
    const { conversationId, dataUrl, base64, mimeType, name } = req.body || {};
    if (!conversationId) {
      return res.status(400).json({ success: false, message: 'conversationId is required' });
    }

    const decoded = decodeBase64Image(dataUrl || base64, mimeType);
    if (decoded.error) {
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

    const now = new Date();
    const subPath = `${conversationId}/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}`;
    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const image = sharp(decoded.buffer, { failOnError: false});
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

    const publicFull = `/uploads/${subPath}/${baseName}.avif`;
    const publicThumb = `/uploads/${subPath}/${baseName}_thumb.avif`;
    const publicFullJpeg = `/uploads/${subPath}/${baseName}.jpg`;
    const publicThumbJpeg = `/uploads/${subPath}/${baseName}_thumb.jpg`;

    if (!fullBuffer || !Buffer.isBuffer(fullBuffer) || fullBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid image buffer' });
    }
    if (!thumbBuffer || !Buffer.isBuffer(thumbBuffer) || thumbBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid thumbnail buffer' });
    }
    if (!fullJpegBuffer || !Buffer.isBuffer(fullJpegBuffer) || fullJpegBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid JPEG buffer' });
    }
    if (!thumbJpegBuffer || !Buffer.isBuffer(thumbJpegBuffer) || thumbJpegBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid JPEG thumbnail buffer' });
    }

    const savedImage = await UploadedImage.createFromBuffers({
      imageId: baseName,
      conversationId: conversationId.toString(),
      imageType: 'conversation',
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

    if (!savedImage || !savedImage.imageId) {
      return res.status(500).json({ success: false, message: 'Failed to save image' });
    }
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
    
    return res.status(404).json({ 
      success: false, 
      message: 'Image not found' 
    });
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      message: 'Error serving image' 
    });
  }
});

// Nova rota para upload de imagens de marketplace
router.post('/marketplace-image', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const originalMime = req.file.mimetype;
    const now = new Date();
    const subPath = `marketplace/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}`;
    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const image = sharp(req.file.buffer, { failOnError: false});
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

    const publicFull = `/uploads/${subPath}/${baseName}.avif`;
    const publicThumb = `/uploads/${subPath}/${baseName}_thumb.avif`;
    const publicFullJpeg = `/uploads/${subPath}/${baseName}.jpg`;
    const publicThumbJpeg = `/uploads/${subPath}/${baseName}_thumb.jpg`;

    if (!fullBuffer || !Buffer.isBuffer(fullBuffer) || fullBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid image buffer' });
    }
    if (!thumbBuffer || !Buffer.isBuffer(thumbBuffer) || thumbBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid thumbnail buffer' });
    }
    if (!fullJpegBuffer || !Buffer.isBuffer(fullJpegBuffer) || fullJpegBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid JPEG buffer' });
    }
    if (!thumbJpegBuffer || !Buffer.isBuffer(thumbJpegBuffer) || thumbJpegBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Invalid JPEG thumbnail buffer' });
    }

    const savedImage = await UploadedImage.createFromBuffers({
      imageId: baseName,
      conversationId: null,
      imageType: 'marketplace',
      fullImage: fullBuffer,
      thumbImage: thumbBuffer,
      fullImageJpeg: fullJpegBuffer,
      thumbImageJpeg: thumbJpegBuffer,
      metadata: {
        originalName: req.file.originalname,
        originalSize: req.file.size,
        originalMimeType: originalMime,
        width: metadata.width,
        height: metadata.height
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

    if (!savedImage || !savedImage.imageId) {
      return res.status(500).json({ success: false, message: 'Failed to save image' });
    }
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
        uploadedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Upload failed' });
  }
});

module.exports = router;

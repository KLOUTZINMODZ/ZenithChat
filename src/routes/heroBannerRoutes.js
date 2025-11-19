const express = require('express');
const router = express.Router();
const HeroBanner = require('../models/HeroBanner');

// Middleware para aumentar limite de payload para imagens base64
router.use(express.json({ limit: '50mb' }));
router.use(express.urlencoded({ extended: true, limit: '50mb' }));

// OPTIONS handler para CORS preflight
router.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key, X-API-Key, X-Panel-Proxy-Secret');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

// Middleware para verificar chave de admin
function requireAdminKey(req, res, next) {
  try {
    const normalize = (v) => (v == null ? '' : String(v).trim());
    const headerPanel = normalize(req.headers['x-panel-proxy-secret']);
    const headerAdmin = normalize(req.headers['x-admin-key'] || req.headers['x-api-key']);
    const panelSecret = normalize(process.env.PANEL_PROXY_SECRET || '');
    const adminKey = normalize(process.env.ADMIN_API_KEY || '');

    // Allow trusted origin without additional headers
    const origin = normalize(req.headers.origin || req.headers.referer || '');
    const TRUSTED_ORIGINS = ['https://zenithpaineladm.vercel.app'];
    if (TRUSTED_ORIGINS.some((o) => origin.startsWith(o))) {
      return next();
    }

    // Prefer PANEL_PROXY_SECRET. If it matches, allow.
    if (panelSecret && headerPanel && headerPanel === panelSecret) {
      return next();
    }
    // Backward compatibility: accept ADMIN_API_KEY if present and matches
    if (adminKey && headerAdmin && headerAdmin === adminKey) {
      return next();
    }

    return res.status(403).json({ success: false, message: 'Acesso negado' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Erro na verificação de chave de admin', error: e?.message });
  }
}

// GET - Buscar todos os banners ativos (público)
router.get('/active', async (req, res) => {
  try {
    const banners = await HeroBanner.find({ isActive: true })
      .sort({ order: 1 })
      .limit(6)
      .select('-__v')
      .lean();

    res.json({
      success: true,
      data: banners
    });
  } catch (error) {
    console.error('Error fetching active banners:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar banners'
    });
  }
});

// GET - Buscar todos os banners (admin)
router.get('/all', requireAdminKey, async (req, res) => {
  try {
    const banners = await HeroBanner.find()
      .sort({ order: 1 })
      .select('-__v')
      .lean();

    res.json({
      success: true,
      data: banners
    });
  } catch (error) {
    console.error('Error fetching all banners:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar banners'
    });
  }
});

// GET - Buscar banner por ID (admin)
router.get('/:id', requireAdminKey, async (req, res) => {
  try {
    const banner = await HeroBanner.findById(req.params.id);
    
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner não encontrado'
      });
    }

    res.json({
      success: true,
      data: banner
    });
  } catch (error) {
    console.error('Error fetching banner:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar banner'
    });
  }
});

// POST - Criar novo banner (admin)
router.post('/', requireAdminKey, async (req, res) => {
  try {
    const {
      order,
      title,
      highlightText,
      description,
      backgroundImage,
      badge,
      primaryButton,
      secondaryButton,
      isActive
    } = req.body;

    // Validações
    if (!title || !description || !backgroundImage) {
      return res.status(400).json({
        success: false,
        message: 'Título, descrição e imagem são obrigatórios'
      });
    }

    if (!primaryButton || !primaryButton.text || !primaryButton.link) {
      return res.status(400).json({
        success: false,
        message: 'Botão principal é obrigatório'
      });
    }

    // Verificar limite de 6 banners ativos
    if (isActive !== false) {
      const activeBannersCount = await HeroBanner.countDocuments({ isActive: true });
      if (activeBannersCount >= 6) {
        return res.status(400).json({
          success: false,
          message: 'Limite de 6 banners ativos atingido. Desative um banner antes de criar outro.'
        });
      }
    }

    // Criar banner
    const newBanner = new HeroBanner({
      order: order || 1,
      title,
      highlightText,
      description,
      backgroundImage,
      badge,
      primaryButton,
      secondaryButton,
      isActive: isActive !== false
    });

    await newBanner.save();

    res.status(201).json({
      success: true,
      message: 'Banner criado com sucesso',
      data: newBanner
    });
  } catch (error) {
    console.error('Error creating banner:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao criar banner',
      error: error.message
    });
  }
});

// Handler compartilhado para PUT e PATCH
const updateBannerHandler = async (req, res) => {
  try {
    const bannerId = req.params.id;
    const updates = req.body;

    // Verificar se banner existe
    const banner = await HeroBanner.findById(bannerId);
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner não encontrado'
      });
    }

    // Validar limite de banners ativos se estiver ativando
    if (updates.isActive === true && banner.isActive === false) {
      const activeBannersCount = await HeroBanner.countDocuments({ 
        isActive: true,
        _id: { $ne: bannerId }
      });
      
      if (activeBannersCount >= 6) {
        return res.status(400).json({
          success: false,
          message: 'Limite de 6 banners ativos atingido'
        });
      }
    }

    // Atualizar
    const updatedBanner = await HeroBanner.findByIdAndUpdate(
      bannerId,
      { ...updates, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Banner atualizado com sucesso',
      data: updatedBanner
    });
  } catch (error) {
    console.error('Error updating banner:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao atualizar banner',
      error: error.message
    });
  }
};

// PATCH - Alterar ordem dos banners (admin) - DEVE VIR ANTES DE /:id
router.patch('/reorder', requireAdminKey, async (req, res) => {
  try {
    const { banners } = req.body; // Array de { id, order }

    if (!Array.isArray(banners)) {
      return res.status(400).json({
        success: false,
        message: 'Formato inválido'
      });
    }

    // Atualizar ordem de cada banner
    const updatePromises = banners.map(({ id, order }) =>
      HeroBanner.findByIdAndUpdate(id, { order, updatedAt: Date.now() })
    );

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: 'Ordem atualizada com sucesso'
    });
  } catch (error) {
    console.error('Error reordering banners:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao reordenar banners'
    });
  }
});

// PUT - Atualizar banner (admin)
router.put('/:id', requireAdminKey, updateBannerHandler);

// PATCH - Atualizar banner (admin) - Compatibilidade
router.patch('/:id', requireAdminKey, updateBannerHandler);

// DELETE - Deletar banner (admin)
router.delete('/:id', requireAdminKey, async (req, res) => {
  try {
    const banner = await HeroBanner.findByIdAndDelete(req.params.id);
    
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Banner deletado com sucesso'
    });
  } catch (error) {
    console.error('Error deleting banner:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao deletar banner'
    });
  }
});

module.exports = router;

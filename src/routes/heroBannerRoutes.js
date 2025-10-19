const express = require('express');
const router = express.Router();
const HeroBanner = require('../models/HeroBanner');
const { auth, adminAuth } = require('../middleware/auth');

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
router.get('/all', adminAuth, async (req, res) => {
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
router.get('/:id', adminAuth, async (req, res) => {
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
router.post('/', adminAuth, async (req, res) => {
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

// PUT - Atualizar banner (admin)
router.put('/:id', adminAuth, async (req, res) => {
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
});

// DELETE - Deletar banner (admin)
router.delete('/:id', adminAuth, async (req, res) => {
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

// PATCH - Alterar ordem dos banners (admin)
router.patch('/reorder', adminAuth, async (req, res) => {
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

module.exports = router;

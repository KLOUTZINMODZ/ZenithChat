const User = require('../models/User');

/**
 * Obtém todos os favoritos do usuário
 */
const getFavorites = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Usuário não encontrado' 
      });
    }

    return res.status(200).json({
      success: true,
      data: { favorites: user.favorites || [] }
    });
  } catch (error) {
    console.error('Erro ao obter favoritos:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao obter favoritos',
      error: error.message
    });
  }
};

/**
 * Adiciona um item aos favoritos do usuário
 */
const addFavorite = async (req, res) => {
  try {
    const { itemId, title, price, image, category } = req.body;
    
    // Validação básica
    if (!itemId || !title) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID do item e título são obrigatórios' 
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Usuário não encontrado' 
      });
    }

    // Verifica se o item já está nos favoritos
    const itemExists = user.favorites.some(fav => fav.itemId === itemId);
    if (itemExists) {
      return res.status(400).json({
        success: false,
        message: 'Item já está nos favoritos'
      });
    }

    // Adiciona o item aos favoritos
    user.favorites.push({
      itemId,
      title,
      price: price || 0,
      image: image || null,
      category: category || null,
      addedAt: new Date()
    });

    await user.save();

    return res.status(201).json({
      success: true,
      message: 'Item adicionado aos favoritos',
      data: { favorites: user.favorites }
    });
  } catch (error) {
    console.error('Erro ao adicionar favorito:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao adicionar favorito',
      error: error.message
    });
  }
};

/**
 * Remove um item dos favoritos do usuário
 */
const removeFavorite = async (req, res) => {
  try {
    const { itemId } = req.params;
    
    if (!itemId) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID do item é obrigatório' 
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Usuário não encontrado' 
      });
    }

    // Verifica se o item existe nos favoritos
    const initialLength = user.favorites.length;
    user.favorites = user.favorites.filter(fav => fav.itemId !== itemId);
    
    if (user.favorites.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Item não encontrado nos favoritos'
      });
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Item removido dos favoritos',
      data: { favorites: user.favorites }
    });
  } catch (error) {
    console.error('Erro ao remover favorito:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao remover favorito',
      error: error.message
    });
  }
};

/**
 * Limpa todos os favoritos do usuário
 */
const clearFavorites = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Usuário não encontrado' 
      });
    }

    user.favorites = [];
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Todos os favoritos foram removidos',
      data: { favorites: [] }
    });
  } catch (error) {
    console.error('Erro ao limpar favoritos:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao limpar favoritos',
      error: error.message
    });
  }
};

module.exports = {
  getFavorites,
  addFavorite,
  removeFavorite,
  clearFavorites
};

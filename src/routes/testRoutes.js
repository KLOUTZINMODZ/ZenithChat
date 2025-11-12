const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

/**
 * @route   GET /api/test/echo
 * @desc    Rota de teste que ecoa os parâmetros recebidos
 */
router.get('/echo', (req, res) => {
  res.json({
    success: true,
    method: req.method,
    query: req.query,
    headers: req.headers,
    message: 'GET Echo teste'
  });
});

/**
 * @route   POST /api/test/echo
 * @desc    Rota de teste que ecoa o body recebido
 */
router.post('/echo', (req, res) => {
  res.json({
    success: true,
    method: req.method,
    body: req.body,
    headers: req.headers,
    message: 'POST Echo teste'
  });
});

/**
 * @route   POST /api/test/favorites
 * @desc    Rota de teste para simular adição de favoritos
 */
router.post('/favorites', auth, (req, res) => {
  console.log('Rota de teste de favoritos chamada');
  console.log('Método:', req.method);
  console.log('Body:', req.body);
  console.log('Headers:', req.headers);
  
  res.json({
    success: true,
    message: 'Teste de favoritos recebido',
    data: {
      received: req.body,
      user: req.user ? {
        id: req.user._id,
        name: req.user.name
      } : null
    }
  });
});

module.exports = router;

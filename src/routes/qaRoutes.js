const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const qaController = require('../controllers/qaController');

// Listar perguntas e respostas de um produto (público)
router.get('/items/:itemId/questions', qaController.listByItem);

// Criar nova pergunta (compradores autenticados; não pode ser o vendedor)
router.post('/items/:itemId/questions', auth, qaController.createQuestion);

// Responder a uma pergunta (somente vendedor)
router.post('/questions/:id/answer', auth, qaController.answerQuestion);

// Denunciar uma pergunta (usuários autenticados; não pode denunciar a própria pergunta)
router.post('/questions/:id/report', auth, qaController.reportQuestion);

module.exports = router;

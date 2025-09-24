const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');

function onlyDigits(v) { return String(v || '').replace(/\D/g, ''); }
function normalizeBrazilPhone(raw) {
  try {
    if (!raw) return null;
    let d = onlyDigits(raw);
    if (!d) return null;
    if (d.startsWith('55') && d.length >= 12 && d.length <= 13) return d;
    if (d.length > 13 && d.includes('55')) {
      const idx = d.indexOf('55');
      d = d.slice(idx);
      if (d.length >= 12 && d.length <= 13) return d;
    }
    if (d.length === 10 || d.length === 11) return '55' + d;
    return '55' + d;
  } catch (_) { return null; }
}

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    return res.json({ success: true, data: { user } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao obter perfil', error: error.message });
  }
});

router.put('/me', auth, async (req, res) => {
  try {
    const { phone, phoneNumber, whatsapp, mobile } = req.body || {};
    const updates = {};

    if (typeof phone === 'string') updates.phone = phone;
    if (typeof phoneNumber === 'string') updates.phoneNumber = phoneNumber;
    if (typeof whatsapp === 'string') updates.whatsapp = whatsapp;
    if (typeof mobile === 'string') updates.mobile = mobile;

    const best = phone || whatsapp || phoneNumber || mobile || null;
    const normalized = normalizeBrazilPhone(best);
    updates.phoneNormalized = normalized;

    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true });
    return res.json({ success: true, data: { user } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao atualizar perfil', error: error.message });
  }
});

module.exports = router;

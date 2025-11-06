const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

// Endpoint 1: Callback do Google OAuth
exports.googleCallback = async (req, res) => {
  try {
    const { code, redirectUri } = req.body;

    if (!code || !redirectUri) {
      return res.status(400).json({
        success: false,
        error: 'Código ou URI de redirecionamento ausente'
      });
    }

    console.log('🔵 Google OAuth - Trocando código por tokens...');

    // Trocar código por tokens
    const { tokens } = await googleClient.getToken({
      code,
      redirect_uri: redirectUri
    });

    console.log('✅ Tokens obtidos do Google');

    // Verificar token ID
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    console.log(`📧 Email do usuário: ${email}`);

    // Verificar se usuário já existe
    let user = await User.findOne({ email });

    if (user) {
      console.log('✅ Usuário existente encontrado');
      
      // Atualizar googleId se não existir
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
        console.log('🔄 GoogleId adicionado ao usuário existente');
      }

      const token = jwt.sign(
        { id: user._id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.json({
        success: true,
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          avatar: user.avatar || picture,
          isVerified: user.isVerified
        }
      });
    } else {
      console.log('🆕 Novo usuário - precisa completar cadastro');
      
      // Novo usuário - precisa completar cadastro com telefone
      const tempToken = jwt.sign(
        {
          email,
          googleId,
          name,
          picture,
          purpose: 'complete-registration'
        },
        process.env.JWT_SECRET,
        { expiresIn: '15m' } // 15 minutos para completar
      );

      return res.json({
        success: true,
        needsAdditionalInfo: true,
        googleToken: tempToken,
        email
      });
    }
  } catch (error) {
    console.error('❌ Erro no Google OAuth callback:', error);
    res.status(400).json({
      success: false,
      error: 'Erro na autenticação com Google: ' + error.message
    });
  }
};

// Endpoint 2: Completar registro com telefone (e senha opcional)
exports.completeGoogleRegistration = async (req, res) => {
  try {
    const { googleToken, phone, password } = req.body;

    if (!googleToken || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Token ou telefone ausente'
      });
    }

    console.log('📱 Completando registro Google com telefone...');
    if (password) {
      console.log('🔐 Senha fornecida (login híbrido habilitado)');
    }

    // Validar e decodificar token temporário
    let decoded;
    try {
      decoded = jwt.verify(googleToken, process.env.JWT_SECRET);
    } catch (err) {
      console.error('❌ Token expirado ou inválido:', err.message);
      return res.status(400).json({
        success: false,
        error: 'Token expirado ou inválido. Por favor, tente fazer login novamente.'
      });
    }

    // Verificar propósito do token
    if (decoded.purpose !== 'complete-registration') {
      return res.status(400).json({
        success: false,
        error: 'Token inválido'
      });
    }

    // Validar formato do telefone
    const phoneRegex = /^\d{10,13}$/;
    const cleanPhone = phone.replace(/\D/g, '');
    
    if (!phoneRegex.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Formato de telefone inválido'
      });
    }

    console.log(`📧 Email: ${decoded.email}`);
    console.log(`📱 Telefone: ${cleanPhone}`);

    // Verificar se email já foi registrado
    const existingUser = await User.findOne({ email: decoded.email });
    if (existingUser) {
      console.log('⚠️ Email já registrado');
      return res.status(400).json({
        success: false,
        error: 'Este email já está registrado'
      });
    }

    // Criar novo usuário
    const userData = {
      email: decoded.email,
      name: decoded.name,
      phone: cleanPhone,
      googleId: decoded.googleId,
      avatar: decoded.picture,
      isVerified: true,
      createdAt: new Date()
    };

    // Se senha foi fornecida, adicionar hash
    if (password && password.trim().length >= 6) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(password, salt);
      console.log('✅ Senha adicionada (login híbrido habilitado)');
    }

    const user = new User(userData);
    await user.save();
    console.log('✅ Usuário criado com sucesso:', user._id);

    // CRÍTICO: Sincronizar com HackLoteAPI (banco principal) se senha foi definida
    if (userData.password) {
      try {
        const mainApiUrl = process.env.VERCEL_API_URL || 'https://zenithggapi.vercel.app';
        const adminSecret = process.env.VERCEL_API_SECRET || 'default_secret';
        
        console.log(`[SYNC] Sincronizando usuário Google com senha para ${user.email}`);
        
        const response = await axios.post(`${mainApiUrl}/api/v1/admin/sync-password`, {
          email: user.email,
          hashedPassword: userData.password
        }, {
          headers: {
            'X-Admin-Secret': adminSecret
          },
          timeout: 5000
        });
        
        console.log(`[SYNC] ✅ Usuário sincronizado com HackLoteAPI: ${response.data.message}`);
      } catch (syncError) {
        console.error(`[SYNC] ⚠️ Erro ao sincronizar com HackLoteAPI:`, {
          message: syncError.message,
          response: syncError.response?.data,
          status: syncError.response?.status
        });
        // NÃO falhar o registro mesmo se sincronização falhar
        // Usuário pode fazer reset de senha se necessário
      }
    }

    // Gerar JWT final
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        avatar: user.avatar,
        isVerified: true
      }
    });
  } catch (error) {
    console.error('❌ Erro ao completar registro:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao completar registro: ' + error.message
    });
  }
};

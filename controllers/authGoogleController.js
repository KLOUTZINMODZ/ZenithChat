const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const axios = require('axios');
const User = require('../src/models/User');

// Helper para garantir que o usuário tenha userid
async function ensureUserIdExists(user) {
  // Verificar se já tem userid no ChatApi (pode não ter o campo definido)
  // Sempre sincronizar com HackLoteAPI para garantir
  try {
    const mainApiUrl = process.env.VERCEL_API_URL || 'https://zenithggapi.vercel.app';
    const adminSecret = process.env.VERCEL_API_SECRET || 'default_secret';
    
    console.log(`[ENSURE-USERID] 🔒 Garantindo userid para ${user.email}`);
    
    const response = await axios.post(`${mainApiUrl}/api/v1/admin/sync-google-user`, {
      email: user.email,
      name: user.name,
      phone: user.phone,
      googleId: user.googleId,
      avatar: user.avatar
    }, {
      headers: {
        'X-Admin-Secret': adminSecret
      },
      timeout: 5000
    });
    
    console.log(`[ENSURE-USERID] ✅ Userid garantido: ${response.data.userid}`);
    return response.data.userid;
  } catch (error) {
    console.error(`[ENSURE-USERID] ❌ Erro ao garantir userid:`, error.message);
    throw new Error('Falha ao garantir userid do usuário');
  }
}

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
        console.log('🔄 GoogleId adicionado ao usuário existente:', googleId);
      } else {
        console.log('✅ GoogleId já existe no usuário:', user.googleId);
      }

      // CRÍTICO: Garantir que usuário tenha userid antes de retornar token
      try {
        await ensureUserIdExists(user);
      } catch (ensureError) {
        console.error(`[LOGIN] ❌ Erro crítico ao garantir userid:`, ensureError.message);
        return res.status(500).json({
          success: false,
          error: 'Erro ao processar autenticação. Por favor, tente novamente.'
        });
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
          googleId: user.googleId || googleId,
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
    let hashedPassword = null;
    if (password && password.trim().length >= 6) {
      hashedPassword = await bcrypt.hash(password, 10);
      userData.password = hashedPassword;
      console.log('✅ Senha adicionada (login híbrido habilitado)');
    }

    const user = new User(userData);
    await user.save();
    console.log('✅ Usuário criado com sucesso:', user._id);

    // CRÍTICO: Sincronizar usuário completo com HackLoteAPI (banco principal)
    try {
      const mainApiUrl = process.env.VERCEL_API_URL || 'https://zenithggapi.vercel.app';
      const adminSecret = process.env.VERCEL_API_SECRET || 'default_secret';
      
      if (hashedPassword) {
        // Usuário com senha - sincronizar com endpoint de senha
        console.log(`[SYNC] Sincronizando usuário com senha para ${user.email}`);
        
        const response = await axios.post(`${mainApiUrl}/api/v1/admin/sync-password`, {
          email: user.email,
          hashedPassword: hashedPassword,
          name: user.name,
          phone: cleanPhone,
          googleId: decoded.googleId,
          avatar: user.avatar
        }, {
          headers: {
            'X-Admin-Secret': adminSecret
          },
          timeout: 5000
        });
        
        console.log(`[SYNC] ✅ Usuário com senha sincronizado: ${response.data.message} (userid: ${response.data.userid})`);
      } else {
        // Usuário só com Google - sincronizar com endpoint específico
        console.log(`[SYNC] Sincronizando usuário Google (sem senha) para ${user.email}`);
        
        const response = await axios.post(`${mainApiUrl}/api/v1/admin/sync-google-user`, {
          email: user.email,
          name: user.name,
          phone: cleanPhone,
          googleId: decoded.googleId,
          avatar: user.avatar
        }, {
          headers: {
            'X-Admin-Secret': adminSecret
          },
          timeout: 5000
        });
        
        console.log(`[SYNC] ✅ Usuário Google sincronizado: ${response.data.message} (userid: ${response.data.userid})`);
      }
    } catch (syncError) {
      console.error(`[SYNC] ❌ Erro ao sincronizar usuário para ${user.email}:`, {
        message: syncError.message,
        response: syncError.response?.data,
        status: syncError.response?.status
      });
      // FALHAR o registro se sincronização falhar (usuário não terá userid válido)
      return res.status(500).json({
        success: false,
        error: 'Erro ao completar registro. Por favor, tente novamente.'
      });
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

// Endpoint 3: Vincular conta existente ao Google
exports.linkGoogleAccount = async (req, res) => {
  try {
    const { googleId, email } = req.body;
    const userId = req.user?.userId || req.user?.id || req.user?._id;

    console.log('🔗 [LINK] Tentando vincular conta ao Google...');
    console.log('🔗 [LINK] Email:', email);
    console.log('🔗 [LINK] GoogleId:', googleId);
    console.log('🔗 [LINK] UserId do token:', userId);

    if (!googleId || !email) {
      return res.status(400).json({
        success: false,
        error: 'GoogleId e email são obrigatórios'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Usuário não autenticado'
      });
    }

    // Buscar usuário atual pelo ID do token
    const currentUser = await User.findById(userId);
    
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    console.log('🔗 [LINK] Usuário encontrado:', currentUser.email);

    // Verificar se o email do Google é o mesmo da conta
    if (currentUser.email.toLowerCase() !== email.toLowerCase()) {
      console.log('❌ [LINK] Emails não coincidem:', currentUser.email, 'vs', email);
      return res.status(400).json({
        success: false,
        error: 'O email do Google deve ser o mesmo da sua conta'
      });
    }

    // Verificar se já está vinculado
    if (currentUser.googleId) {
      console.log('⚠️ [LINK] Conta já vinculada ao Google');
      return res.status(400).json({
        success: false,
        error: 'Esta conta já está vinculada ao Google'
      });
    }

    // Verificar se o googleId já está sendo usado por outra conta
    const existingGoogleUser = await User.findOne({ googleId });
    
    if (existingGoogleUser && existingGoogleUser._id.toString() !== userId.toString()) {
      console.log('❌ [LINK] GoogleId já vinculado a outra conta');
      return res.status(400).json({
        success: false,
        error: 'Esta conta Google já está vinculada a outro usuário'
      });
    }

    // Vincular o Google à conta
    currentUser.googleId = googleId;
    currentUser.isVerified = true; // Marcar como verificado
    await currentUser.save();

    console.log('✅ [LINK] Conta vinculada com sucesso!');

    // Retornar dados atualizados
    res.json({
      success: true,
      message: 'Conta vinculada com sucesso ao Google',
      user: {
        _id: currentUser._id,
        email: currentUser.email,
        name: currentUser.name,
        phone: currentUser.phone,
        avatar: currentUser.avatar,
        googleId: currentUser.googleId,
        isVerified: currentUser.isVerified
      }
    });
  } catch (error) {
    console.error('❌ [LINK] Erro ao vincular conta:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao vincular conta: ' + error.message
    });
  }
};

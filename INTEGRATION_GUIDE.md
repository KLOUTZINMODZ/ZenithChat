# 🚀 Guia Rápido de Integração 2FA

## ⚡ Setup Rápido (5 minutos)

### 1. Verificar Arquivos Criados ✅

Todos os arquivos necessários já foram criados:
- ✅ `src/models/TwoFactorAuth.js`
- ✅ `src/controllers/twoFactorAuthController.js`
- ✅ `src/middleware/rateLimiters.js` (modificado)
- ✅ `src/routes/authRoutes.js` (modificado)

### 2. Configurar Variáveis de Ambiente

Adicione ao seu arquivo `.env`:
```env
RATE_LIMIT_2FA_MAX=3
```

**Nota**: O JWT_SECRET já deve estar configurado.

### 3. Integrar no Fluxo de Login

#### Opção A: Criar novo endpoint de login com 2FA

Crie ou modifique `src/controllers/authController.js`:

```javascript
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const twoFactorAuthController = require('./twoFactorAuthController');
const emailService = require('../services/emailService'); // Seu serviço de email
const logger = require('../utils/logger');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validação básica
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Buscar usuário
    const user = await User.findOne({ email });
    
    if (!user) {
      // Delay para prevenir user enumeration
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Verificar senha (assumindo que você tem hash de senha)
    // Se não tiver, remova esta validação
    // const isValidPassword = await bcrypt.compare(password, user.password);
    // if (!isValidPassword) {
    //   await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
    //   return res.status(401).json({
    //     success: false,
    //     message: 'Invalid credentials'
    //   });
    // }
    
    // Verificar se usuário está banido
    if (user.isBanned()) {
      return res.status(403).json({
        success: false,
        message: 'Account suspended',
        banned: true
      });
    }
    
    // Gerar código 2FA
    const { code, tempToken, expiresAt } = await twoFactorAuthController.generate2FACode(user._id);
    
    // Enviar código por email
    try {
      await emailService.send2FACode(user.email, code, user.name);
    } catch (emailError) {
      logger.error('Failed to send 2FA code', { userId: user._id, error: emailError.message });
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code. Please try again.'
      });
    }
    
    // Retornar tempToken para o cliente
    return res.status(200).json({
      success: true,
      message: 'Verification code sent to your email',
      data: {
        tempToken,
        requiresTwoFactor: true,
        expiresIn: 900 // 15 minutos em segundos
      }
    });
    
  } catch (error) {
    logger.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
```

#### Opção B: Adicionar ao server.js diretamente

Se você não tem um authController, adicione ao `server.js`:

```javascript
// Após as outras rotas de autenticação
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    if (user.isBanned()) {
      return res.status(403).json({ success: false, message: 'Account suspended' });
    }
    
    const twoFactorAuthController = require('./src/controllers/twoFactorAuthController');
    const { code, tempToken } = await twoFactorAuthController.generate2FACode(user._id);
    
    // TODO: Enviar código por email
    console.log(`2FA Code for ${email}: ${code}`); // REMOVER EM PRODUÇÃO!
    
    res.json({
      success: true,
      message: 'Verification code sent',
      data: { tempToken, requiresTwoFactor: true }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});
```

### 4. Configurar Serviço de Email

#### Se você já tem emailService configurado:

Adicione o método `send2FACode`:

```javascript
// src/services/emailService.js

exports.send2FACode = async (email, code, userName) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Código de Verificação</h2>
      <p>Olá ${userName},</p>
      <p>Seu código de verificação é:</p>
      <div style="font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 4px; text-align: center; padding: 20px; background: #f8f9fa; border-radius: 8px; margin: 20px 0;">
        ${code}
      </div>
      <p>Este código expira em <strong>15 minutos</strong>.</p>
      <p style="color: #dc3545; font-size: 14px;">
        ⚠️ Nunca compartilhe este código com ninguém.
      </p>
    </div>
  `;
  
  return await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Seu código de verificação - Zenith',
    html
  });
};
```

#### Se NÃO tem emailService, crie um básico:

```javascript
// src/services/emailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

exports.send2FACode = async (email, code, userName) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2>Código de Verificação</h2>
      <p>Olá ${userName},</p>
      <p>Seu código: <strong style="font-size: 24px; color: #007bff;">${code}</strong></p>
      <p>Expira em 15 minutos.</p>
    </div>
  `;
  
  return await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Código de Verificação',
    html
  });
};
```

Instale nodemailer se necessário:
```bash
npm install nodemailer
```

## 🧪 Testar Implementação

### 1. Testar endpoint diretamente (sem email)

Para desenvolvimento, você pode temporariamente logar o código:

```javascript
// NO CONTROLLER DE LOGIN (APENAS PARA TESTE)
const { code, tempToken } = await twoFactorAuthController.generate2FACode(user._id);

// REMOVER EM PRODUÇÃO!
console.log('=== 2FA CODE (TESTE) ===');
console.log('Email:', user.email);
console.log('Code:', code);
console.log('TempToken:', tempToken);
console.log('========================');
```

### 2. Testar com cURL

```bash
# 1. Login (gera código)
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"senha123"}'

# Resposta:
# {
#   "success": true,
#   "data": {
#     "tempToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#     "requiresTwoFactor": true
#   }
# }

# 2. Verificar código (copie o código do console e o tempToken da resposta)
curl -X POST http://localhost:5000/api/auth/verify-2fa-login \
  -H "Content-Type: application/json" \
  -d '{
    "code":"123456",
    "tempToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'

# Resposta de sucesso:
# {
#   "success": true,
#   "data": {
#     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#     "user": { "id": "...", "name": "...", "email": "..." }
#   }
# }
```

### 3. Testar proteções

```bash
# Testar código inválido (deve retornar remainingAttempts)
curl -X POST http://localhost:5000/api/auth/verify-2fa-login \
  -H "Content-Type: application/json" \
  -d '{"code":"000000","tempToken":"..."}'

# Testar rate limiting (fazer 4 requests rápidos)
for i in {1..4}; do
  curl -X POST http://localhost:5000/api/auth/verify-2fa-login \
    -H "Content-Type: application/json" \
    -d '{"code":"000000","tempToken":"..."}'
  echo ""
done
# 4º request deve retornar HTTP 429
```

## 📱 Frontend Integration

### React Example

```tsx
// pages/Login.tsx
const handleLogin = async (email: string, password: string) => {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const data = await res.json();
  
  if (data.requiresTwoFactor) {
    sessionStorage.setItem('tempToken', data.data.tempToken);
    router.push('/verify-2fa');
  }
};

// pages/Verify2FA.tsx
const handleVerify = async (code: string) => {
  const tempToken = sessionStorage.getItem('tempToken');
  
  const res = await fetch('/api/auth/verify-2fa-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, tempToken })
  });
  
  const data = await res.json();
  
  if (data.success) {
    localStorage.setItem('authToken', data.data.token);
    router.push('/dashboard');
  }
};
```

## ⚠️ Checklist Pré-Produção

Antes de colocar em produção, verifique:

- [ ] `JWT_SECRET` configurado (mínimo 32 caracteres)
- [ ] `RATE_LIMIT_2FA_MAX=3` adicionado ao `.env`
- [ ] Serviço de email configurado e testado
- [ ] `NODE_ENV=production` em produção (desabilita stack traces)
- [ ] HTTPS configurado (obrigatório)
- [ ] Rate limiters testados
- [ ] Logs de segurança configurados
- [ ] Alertas de tentativas excessivas configurados
- [ ] Testado fluxo completo em staging
- [ ] Removidos console.logs de desenvolvimento

## 🐛 Troubleshooting

### Erro: "TwoFactorAuth model not found"
```bash
# Certifique-se que o arquivo foi criado:
ls src/models/TwoFactorAuth.js
```

### Erro: "twoFactorLimiter is not defined"
```bash
# Verifique se foi exportado corretamente em rateLimiters.js
grep "twoFactorLimiter" src/middleware/rateLimiters.js
```

### Emails não estão sendo enviados
```javascript
// Adicione log para debug:
logger.info('Sending 2FA code', { email, hasCode: !!code });
```

### Rate limiting muito agressivo em desenvolvimento
```env
# Aumente temporariamente em .env (NÃO EM PRODUÇÃO):
RATE_LIMIT_2FA_MAX=10
```

## 📞 Suporte

- **Documentação de Segurança**: `2FA_SECURITY_DOCUMENTATION.md`
- **Exemplos Completos**: `2FA_USAGE_EXAMPLES.md`
- **Resumo Executivo**: `2FA_IMPLEMENTATION_SUMMARY.md`

---

**Tempo estimado de integração**: 15-30 minutos (com email configurado)

# Exemplos de Uso - Autenticação 2FA

## 📝 Integração no Fluxo de Login

### 1. Adicionar ao Controller de Login Existente

Modifique seu controller de login para gerar o código 2FA após validar credenciais:

```javascript
// src/controllers/authController.js
const twoFactorAuthController = require('./twoFactorAuthController');
const emailService = require('../services/emailService'); // Seu serviço de email

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // 1. Validar credenciais
    const user = await User.findOne({ email });
    
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // 2. Verificar se usuário está banido
    if (user.isBanned()) {
      return res.status(403).json({
        success: false,
        message: 'Account suspended'
      });
    }
    
    // 3. Gerar código 2FA
    const { code, tempToken } = await twoFactorAuthController.generate2FACode(user._id);
    
    // 4. Enviar código por email
    await emailService.send2FACode(user.email, code, user.name);
    
    // 5. Retornar tempToken para o cliente (não enviar o código!)
    return res.status(200).json({
      success: true,
      message: '2FA code sent to your email',
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

### 2. Template de Email para Código 2FA

```javascript
// src/services/emailService.js

exports.send2FACode = async (email, code, userName) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .code { 
          font-size: 32px; 
          font-weight: bold; 
          color: #007bff; 
          letter-spacing: 4px;
          text-align: center;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 8px;
          margin: 20px 0;
        }
        .warning {
          color: #dc3545;
          font-size: 14px;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Código de Verificação</h2>
        <p>Olá ${userName},</p>
        <p>Seu código de verificação de dois fatores é:</p>
        
        <div class="code">${code}</div>
        
        <p>Este código expira em <strong>15 minutos</strong>.</p>
        
        <div class="warning">
          ⚠️ <strong>Importante:</strong>
          <ul>
            <li>Nunca compartilhe este código com ninguém</li>
            <li>Nossa equipe nunca solicitará este código</li>
            <li>Se você não solicitou este código, ignore este email</li>
          </ul>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Seu código de verificação - Zenith',
    html
  });
};
```

## 🔄 Fluxo Completo Frontend → Backend

### Frontend (React/Vue/Angular)

```typescript
// 1. Login inicial
async function handleLogin(email: string, password: string) {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (data.requiresTwoFactor) {
      // Armazenar tempToken temporariamente
      sessionStorage.setItem('tempToken', data.data.tempToken);
      
      // Redirecionar para página de verificação 2FA
      router.push('/verify-2fa');
    }
  } catch (error) {
    console.error('Login failed:', error);
  }
}

// 2. Verificação do código 2FA
async function handleVerify2FA(code: string) {
  try {
    const tempToken = sessionStorage.getItem('tempToken');
    
    const response = await fetch('/api/auth/verify-2fa-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, tempToken })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Limpar tempToken
      sessionStorage.removeItem('tempToken');
      
      // Armazenar token de autenticação definitivo
      localStorage.setItem('authToken', data.data.token);
      
      // Redirecionar para dashboard
      router.push('/dashboard');
    } else {
      // Mostrar erro e tentativas restantes
      showError(data.message, data.remainingAttempts);
    }
  } catch (error) {
    console.error('2FA verification failed:', error);
  }
}
```

### Componente React de Verificação 2FA

```tsx
import React, { useState, useEffect } from 'react';

function Verify2FAPage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remainingAttempts, setRemainingAttempts] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(900); // 15 minutos

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const tempToken = sessionStorage.getItem('tempToken');
      
      const response = await fetch('/api/auth/verify-2fa-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, tempToken })
      });

      const data = await response.json();

      if (data.success) {
        sessionStorage.removeItem('tempToken');
        localStorage.setItem('authToken', data.data.token);
        window.location.href = '/dashboard';
      } else {
        setError(data.message);
        setRemainingAttempts(data.remainingAttempts);
      }
    } catch (err) {
      setError('Erro ao verificar código. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="verify-2fa-container">
      <h2>Verificação em Duas Etapas</h2>
      <p>Digite o código de 6 dígitos enviado para seu email</p>
      
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          maxLength={6}
          pattern="\d{6}"
          required
          disabled={loading || timeRemaining === 0}
        />
        
        {error && (
          <div className="error">
            {error}
            {remainingAttempts !== null && (
              <span> ({remainingAttempts} tentativas restantes)</span>
            )}
          </div>
        )}
        
        <div className="timer">
          Código expira em: <strong>{formatTime(timeRemaining)}</strong>
        </div>
        
        <button 
          type="submit" 
          disabled={loading || code.length !== 6 || timeRemaining === 0}
        >
          {loading ? 'Verificando...' : 'Verificar Código'}
        </button>
      </form>
      
      {timeRemaining === 0 && (
        <div className="expired">
          Código expirado. Por favor, faça login novamente.
        </div>
      )}
    </div>
  );
}

export default Verify2FAPage;
```

## 🧪 Testes com cURL

### 1. Login (gerar código 2FA)
```bash
curl -X POST https://zenithggapi.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'

# Resposta esperada:
# {
#   "success": true,
#   "message": "2FA code sent to your email",
#   "data": {
#     "tempToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#     "requiresTwoFactor": true,
#     "expiresIn": 900
#   }
# }
```

### 2. Verificar código 2FA
```bash
curl -X POST https://zenithggapi.vercel.app/api/auth/verify-2fa-login \
  -H "Content-Type: application/json" \
  -d '{
    "code": "123456",
    "tempToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'

# Resposta de sucesso:
# {
#   "success": true,
#   "message": "Authentication successful",
#   "data": {
#     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#     "user": {
#       "id": "userId",
#       "name": "User Name",
#       "email": "user@example.com",
#       "avatar": "avatar_url"
#     }
#   }
# }

# Resposta de erro (código inválido):
# {
#   "success": false,
#   "message": "Invalid verification code",
#   "remainingAttempts": 3
# }

# Resposta de erro (bloqueado):
# {
#   "success": false,
#   "message": "Too many attempts. Try again in 14 minutes"
# }

# Resposta de erro (rate limit):
# {
#   "success": false,
#   "message": "Too many verification attempts. Please try again in 5 minutes.",
#   "retryAfter": 287
# }
```

## 🔧 Utilitários para Desenvolvimento

### Invalidar códigos de um usuário (útil para testes)
```javascript
// Script de teste: scripts/invalidate-2fa.js
const mongoose = require('mongoose');
const twoFactorAuthController = require('../src/controllers/twoFactorAuthController');

async function invalidateUserCodes(userId) {
  await mongoose.connect(process.env.MONGODB_URI);
  await twoFactorAuthController.invalidateUserCodes(userId);
  console.log('Códigos 2FA invalidados com sucesso');
  process.exit(0);
}

// Executar: node scripts/invalidate-2fa.js USER_ID
invalidateUserCodes(process.argv[2]);
```

### Limpar registros 2FA antigos (manutenção)
```javascript
// Script de limpeza: scripts/cleanup-2fa.js
const mongoose = require('mongoose');
const TwoFactorAuth = require('../src/models/TwoFactorAuth');

async function cleanup() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Remover registros expirados há mais de 1 dia
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const result = await TwoFactorAuth.deleteMany({
    expiresAt: { $lt: oneDayAgo }
  });
  
  console.log(`${result.deletedCount} registros 2FA antigos removidos`);
  process.exit(0);
}

cleanup();
```

## 📊 Monitoramento

### Query para detectar possíveis ataques
```javascript
// scripts/detect-bruteforce.js
const TwoFactorAuth = require('../src/models/TwoFactorAuth');

async function detectBruteforce() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  
  // Agrupar por IP com muitas tentativas
  const suspiciousIPs = await TwoFactorAuth.aggregate([
    { $match: { createdAt: { $gte: fiveMinutesAgo } } },
    { $group: {
      _id: '$ipAddress',
      attempts: { $sum: '$attempts' },
      count: { $sum: 1 }
    }},
    { $match: { $or: [
      { attempts: { $gte: 10 } },
      { count: { $gte: 5 } }
    ]}},
    { $sort: { attempts: -1 } }
  ]);
  
  if (suspiciousIPs.length > 0) {
    console.log('⚠️ IPs suspeitos detectados:');
    console.table(suspiciousIPs);
  } else {
    console.log('✅ Nenhuma atividade suspeita detectada');
  }
}

setInterval(detectBruteforce, 5 * 60 * 1000); // Executar a cada 5 minutos
```

## 🎯 Boas Práticas

1. **Nunca** armazene o código 2FA em localStorage/sessionStorage
2. **Sempre** use HTTPS em produção
3. **Implemente** notificações de login para usuários
4. **Considere** adicionar device fingerprinting
5. **Monitore** tentativas de login suspeitas
6. **Configure** alertas para bloqueios frequentes
7. **Revise** logs de segurança periodicamente
8. **Teste** regularmente o fluxo completo

## 📚 Recursos Adicionais

- [Documentação de Segurança](./2FA_SECURITY_DOCUMENTATION.md)
- [Código do Controller](./src/controllers/twoFactorAuthController.js)
- [Código do Modelo](./src/models/TwoFactorAuth.js)
- [Rotas](./src/routes/authRoutes.js)

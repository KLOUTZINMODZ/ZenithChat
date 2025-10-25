# Documentação de Segurança - Autenticação 2FA

## 📋 Visão Geral

A rota de verificação 2FA foi implementada com múltiplas camadas de segurança para proteger contra as principais vulnerabilidades de autenticação.

## 🔒 Proteções Implementadas

### 1. **Proteção contra Bruteforce**

#### Rate Limiting (Camada 1)
- **Limite por IP + Token**: 3 tentativas a cada 5 minutos
- **Middleware**: `twoFactorLimiter` 
- **Configuração**: Variável `RATE_LIMIT_2FA_MAX` no `.env`
- **Comportamento**: Tentativas bem-sucedidas não são contadas

#### Bloqueio no Banco de Dados (Camada 2)
- **Tentativas máximas**: 5 tentativas por código
- **Bloqueio**: 15 minutos após exceder tentativas
- **Reset automático**: Após período de bloqueio
- **Armazenamento**: Campo `attempts` e `lockedUntil` no modelo `TwoFactorAuth`

### 2. **Proteção contra Replay Attacks**

#### Token de Uso Único
- **Nonce único**: Cada `tempToken` inclui um nonce aleatório de 16 bytes
- **Marcação de uso**: Campo `used` e `usedAt` no banco
- **Validação**: Rejeita tentativas com códigos já utilizados
- **Status code**: `401 Unauthorized` para tentativas de reutilização

#### Expiração de Token
- **Validade do tempToken**: 15 minutos
- **Validade do código**: 15 minutos (sincronizado com tempToken)
- **TTL no MongoDB**: Índice com `expireAfterSeconds: 0` no campo `expiresAt`
- **Limpeza automática**: MongoDB remove registros expirados

### 3. **Proteção contra Timing Attacks**

#### Comparação Constant-Time
```javascript
// Uso de crypto.timingSafeEqual para comparação segura
function constantTimeCompare(a, b) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  
  if (aBuffer.length !== bBuffer.length) {
    // Ainda faz comparação para evitar timing leak
    crypto.timingSafeEqual(
      crypto.createHash('sha256').update(a).digest(),
      crypto.createHash('sha256').update(b).digest()
    );
    return false;
  }
  
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}
```

#### Delays Artificiais
- **Erro de validação**: Delay aleatório de 200-300ms
- **Token inválido**: Delay aleatório de 200-300ms
- **Código inválido**: Delay aleatório de 200-300ms
- **Objetivo**: Prevenir análise de timing para identificar erros específicos

#### Armazenamento Seguro
- **Hash SHA-256**: Códigos são hasheados antes de armazenar no banco
- **Nunca armazenado em texto claro**: Apenas hash é persistido
- **Comparação de hashes**: Comparação é feita entre hashes, não texto claro

### 4. **Logs e Exposição de Dados Sensíveis**

#### Dados NÃO Logados
- ❌ Código 2FA (texto claro ou hash)
- ❌ Token completo (apenas últimos 8 caracteres em rate limiter)
- ❌ Stack trace em produção
- ❌ Informações de sessão sensíveis

#### Dados Logados (Seguros)
- ✅ User ID (para auditoria)
- ✅ IP Address (para detecção de fraude)
- ✅ Número de tentativas
- ✅ Status de sucesso/falha
- ✅ Timestamps
- ✅ Duração da operação

#### Exemplo de Log Seguro
```javascript
logger.warn('Invalid 2FA code attempt', {
  userId: decoded.userId,         // ID não é sensível
  attempts: record.attempts,       // Contador para auditoria
  remainingAttempts,              // Informação útil
  ip: req.ip                      // Para detecção de padrões
  // ❌ Nunca: code, tempToken completo, hash
});
```

## 🔐 Fluxo de Autenticação Seguro

### Passo 1: Geração do Código 2FA
```javascript
const { code, tempToken } = await twoFactorAuthController.generate2FACode(userId);
// code: enviado para o usuário (email/SMS)
// tempToken: retornado para o cliente
```

### Passo 2: Verificação do Código
```http
POST /api/auth/verify-2fa-login
Content-Type: application/json

{
  "code": "123456",
  "tempToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Passo 3: Validações em Camadas
1. ✅ Rate limiting (IP + token)
2. ✅ Validação de formato (6 dígitos)
3. ✅ Verificação do tempToken JWT
4. ✅ Tipo de token (`2fa-pending`)
5. ✅ Existência do registro no banco
6. ✅ Verificação de uso prévio (replay)
7. ✅ Verificação de expiração
8. ✅ Verificação de bloqueio (tentativas)
9. ✅ Comparação constant-time do código
10. ✅ Verificação de banimento do usuário

### Passo 4: Resposta
```json
// Sucesso
{
  "success": true,
  "message": "Authentication successful",
  "data": {
    "token": "JWT_AUTH_TOKEN",
    "user": {
      "id": "userId",
      "name": "User Name",
      "email": "user@email.com",
      "avatar": "avatar_url"
    }
  }
}

// Falha
{
  "success": false,
  "message": "Invalid verification code",
  "remainingAttempts": 3
}
```

## 🛡️ Configuração de Segurança

### Variáveis de Ambiente
```env
# Rate limiting
RATE_LIMIT_2FA_MAX=3              # Tentativas por janela de tempo

# JWT
JWT_SECRET=your_secure_secret     # Chave forte para JWT

# Node Environment
NODE_ENV=production               # Desabilita stack traces em logs
```

### Recomendações de Produção
1. **JWT_SECRET**: Mínimo 32 caracteres, gerado com `crypto.randomBytes(32).toString('hex')`
2. **HTTPS**: Sempre usar HTTPS em produção
3. **Monitoramento**: Configurar alertas para tentativas excessivas
4. **Firewall**: WAF para proteção adicional contra bots
5. **Captcha**: Considerar adicionar após múltiplas falhas

## 📊 Métricas de Segurança

### Indicadores para Monitorar
- Taxa de falhas de verificação 2FA por IP
- Tentativas de replay attack (códigos reutilizados)
- Bloqueios por tentativas excessivas
- Tempo médio de verificação (detectar anomalias)
- Códigos expirados antes de uso

### Alertas Recomendados
```javascript
// Exemplo de alerta
if (failureRate > 0.5 && attempts > 100) {
  alert('Possível ataque de bruteforce em 2FA');
}

if (replayAttempts > 10) {
  alert('Múltiplas tentativas de replay attack');
}
```

## 🔧 Manutenção e Auditoria

### Limpeza de Dados
- **Automática**: MongoDB TTL index remove registros expirados
- **Manual**: Script de limpeza para registros antigos não utilizados

### Invalidação de Códigos
```javascript
// Invalidar todos os códigos de um usuário (logout/segurança)
await twoFactorAuthController.invalidateUserCodes(userId);
```

### Auditoria
- Logs estruturados em formato JSON
- Retenção recomendada: 90 dias
- Análise periódica de padrões de ataque
- Revisão de IPs bloqueados

## 🚨 Resposta a Incidentes

### Se detectar ataque de bruteforce:
1. Verificar logs de tentativas por IP
2. Adicionar IP à blacklist temporária
3. Notificar usuários afetados
4. Revisar e ajustar limites de rate limiting

### Se detectar replay attacks:
1. Verificar se tokens estão sendo interceptados
2. Revisar configuração HTTPS/TLS
3. Considerar adicionar device fingerprinting
4. Implementar notificações de login suspeito

## 📚 Referências de Segurança

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [NIST Digital Identity Guidelines](https://pages.nist.gov/800-63-3/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

## 🔄 Changelog

### v1.0.0 - 2024-10-25
- ✅ Implementação inicial com todas as proteções
- ✅ Rate limiting em duas camadas
- ✅ Comparação constant-time
- ✅ Proteção contra replay attacks
- ✅ Logging seguro sem exposição de dados
- ✅ Documentação completa de segurança

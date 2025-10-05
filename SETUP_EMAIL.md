# 📧 Configuração do Sistema de Recuperação de Senha

Este guia explica como configurar o sistema de recuperação de senha usando Gmail.

## 🔧 Configuração do Gmail

### 1. Criar uma Senha de App do Gmail

1. Acesse sua conta Google: [https://myaccount.google.com](https://myaccount.google.com)
2. Vá em **Segurança** → **Verificação em duas etapas** (ative se ainda não estiver)
3. Role até **Senhas de app**: [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
4. Selecione:
   - **App:** Email
   - **Dispositivo:** Outro (nome personalizado) → "HackLote API"
5. Clique em **Gerar**
6. **Copie a senha gerada** (16 caracteres sem espaços)

### 2. Configurar Variáveis de Ambiente

No arquivo `.env` do **HackloteChatApi**, adicione:

```bash
EMAIL_USER=seu-email@gmail.com
EMAIL_PASSWORD=sua_senha_de_app_16_digitos
```

**Exemplo:**
```bash
EMAIL_USER=contato@hacklote.com
EMAIL_PASSWORD=abcd efgh ijkl mnop
```

## 📦 Instalação de Dependências

```bash
cd HackloteChatApi
npm install nodemailer
```

## 🔐 Recursos de Segurança Implementados

### 1. Validação de Provedores Confiáveis
Apenas emails dos seguintes provedores são aceitos:
- Gmail / Google Mail
- Outlook / Hotmail / Live
- Yahoo
- iCloud / Me
- ProtonMail
- AOL
- Zoho
- Mail.com

### 2. Rate Limiting
- **Máximo:** 3 solicitações por hora por IP
- **Objetivo:** Prevenir ataques de força bruta

### 3. Expiração de Código
- **Validade:** 15 minutos
- Códigos expirados são automaticamente deletados do banco

### 4. Limitação de Tentativas
- **Máximo:** 5 tentativas por código
- Código é invalidado após 5 tentativas incorretas

### 5. Código de 8 Dígitos
- Código numérico aleatório
- 100.000.000 combinações possíveis
- Dificuldade extrema de adivinhação

### 6. Proteção Contra Enumeração
- API sempre retorna "sucesso" mesmo se email não existir
- Previne descoberta de emails cadastrados

### 7. Invalidação Automática
- Códigos anteriores são invalidados ao solicitar novo
- Apenas 1 código ativo por usuário

## 🚀 Testando o Sistema

### 1. Solicitar Código

```bash
POST http://localhost:3003/api/auth/forgot-password
Content-Type: application/json

{
  "email": "seu-email@gmail.com"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Código de recuperação enviado para seu email!",
  "data": {
    "expiresIn": 900
  }
}
```

### 2. Verificar Código

```bash
POST http://localhost:3003/api/auth/verify-reset-code
Content-Type: application/json

{
  "email": "seu-email@gmail.com",
  "code": "12345678"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Código verificado com sucesso!",
  "data": {
    "resetToken": "60a1b2c3d4e5f6g7h8i9j0k1"
  }
}
```

### 3. Redefinir Senha

```bash
POST http://localhost:3003/api/auth/reset-password
Content-Type: application/json

{
  "resetToken": "60a1b2c3d4e5f6g7h8i9j0k1",
  "newPassword": "novaSenhaSegura123"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Senha redefinida com sucesso! Você já pode fazer login."
}
```

## 🎨 Frontend

A página de recuperação está disponível em:
```
http://localhost:5173/forgot-password
```

### Fluxo do Usuário:

1. **Passo 1:** Digita o email
2. **Passo 2:** Recebe código por email e digita na página
3. **Passo 3:** Cria nova senha
4. **Conclusão:** Redirecionado para login

## 📊 Modelo de Dados

**Coleção:** `PasswordReset`

```javascript
{
  userId: ObjectId,
  email: String,
  code: String (8 dígitos),
  expiresAt: Date,
  used: Boolean,
  attempts: Number,
  ipAddress: String,
  userAgent: String,
  createdAt: Date
}
```

## ⚠️ Troubleshooting

### Erro: "Error sending email"

**Solução:**
1. Verifique se a senha de app está correta
2. Confirme que a verificação em 2 etapas está ativada
3. Tente gerar uma nova senha de app
4. Verifique se o EMAIL_USER e EMAIL_PASSWORD estão no `.env`

### Erro: "Email inválido"

**Solução:**
- Use um email de provedor confiável (Gmail, Outlook, Yahoo, etc.)
- Verifique se o formato do email está correto

### Código não chega

**Solução:**
1. Verifique a caixa de spam
2. Aguarde até 2 minutos
3. Verifique os logs do servidor: `tail -f logs/combined.log`

## 🔒 Boas Práticas de Produção

1. **Use HTTPS** em produção
2. **Configure CORS** adequadamente
3. **Monitore logs** para detectar abusos
4. **Use Redis** para rate limiting escalável
5. **Implemente CAPTCHA** após múltiplas tentativas
6. **Configure alertas** para atividades suspeitas
7. **Backup regular** da collection PasswordReset

## 📚 Referências

- [Nodemailer Documentation](https://nodemailer.com/)
- [Gmail App Passwords](https://support.google.com/accounts/answer/185833)
- [OWASP Password Reset](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)

# Configuração do Sistema de Webhook para Marketplace Highlights

## 🎯 Visão Geral
O sistema de webhook foi movido da API principal (Vercel) para a HackloteChatApi devido às limitações do Vercel com WebSockets e webhooks persistentes.

## 🔧 Arquitetura da Solução

### Fluxo do Webhook
1. **Mercado Pago** → **HackloteChatApi** (webhook)
2. **HackloteChatApi** → **API Vercel** (comunicação interna)
3. **API Vercel** aplica highlights nos itens do marketplace

## ⚙️ Configuração das Variáveis de Ambiente

### HackloteChatApi (.env)
```env
# Configuração existente...
PORT=3001
MONGODB_URI=your_mongodb_connection_string
NODE_ENV=development

# Novas variáveis para webhook
VERCEL_API_URL=https://your-main-api.vercel.app
VERCEL_API_SECRET=your_secure_secret_key_here
MERCADO_PAGO_ACCESS_TOKEN=your_mercado_pago_token
```

### API Principal Vercel (.env ou configuração)
```env
# Configuração existente...
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret

# Novas variáveis para comunicação interna
VERCEL_API_SECRET=your_secure_secret_key_here
CHAT_API_URL=https://12zku8.instatunnel.my
```

## 🚀 Endpoints Criados

### Na HackloteChatApi
- **POST** `/api/marketplace-webhook/mercadopago-webhook`
  - Recebe notificações do Mercado Pago
  - Processa pagamentos aprovados
  - Comunica com API principal

- **POST** `/api/marketplace-webhook/test-webhook` 
  - Endpoint para testes durante desenvolvimento
  - Simula notificações do Mercado Pago

- **GET** `/api/marketplace-webhook/health`
  - Health check do serviço de webhook

### Na API Principal (Vercel)
- **POST** `/api/marketplace-highlights-internal`
  - Endpoint interno para aplicar highlights
  - Aceita apenas chamadas da HackloteChatApi
  - Autenticado via secret interno

## 🔐 Segurança

### Autenticação entre APIs
- Header `X-Webhook-Source: HackloteChatApi` para identificação
- Header `Authorization: Bearer SECRET` para autenticação
- Verificação de secret interno compartilhado

### Validações
- Estrutura das notificações do Mercado Pago
- Status de pagamento (apenas 'approved')
- Existência do usuário
- Formato da referência externa

## 📋 URLs de Configuração

### Para Mercado Pago (produção)
```
Notification URL: https://your-chat-api-domain.com/api/marketplace-webhook/mercadopago-webhook
```

### Para desenvolvimento local
```
Notification URL: https://12zku8.instatunnel.my/api/marketplace-webhook/mercadopago-webhook
```

## 🧪 Como Testar

### 1. Teste Local Simples
```bash
curl -X POST https://12zku8.instatunnel.my/api/marketplace-webhook/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"userId": "USER_ID_HERE", "paymentId": "test_payment_123"}'
```

### 2. Simulação de Webhook do Mercado Pago
```bash
curl -X POST https://12zku8.instatunnel.my/api/marketplace-webhook/mercadopago-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "payment",
    "data": {
      "id": "123456789"
    },
    "user_id": "USER_ID_HERE"
  }'
```

### 3. Health Check
```bash
curl https://12zku8.instatunnel.my/api/marketplace-webhook/health
```

## 🔄 Processo de Deploy

### 1. HackloteChatApi
1. Configurar variáveis de ambiente
2. Garantir que o servidor está rodando
3. Testar conectividade com a API principal

### 2. API Principal (Vercel)
1. Adicionar variável `VERCEL_API_SECRET`
2. Fazer deploy do novo endpoint `/api/marketplace-highlights-internal`
3. Atualizar variável `CHAT_API_URL` se necessário

### 3. Mercado Pago
1. Atualizar URL de notificação para apontar para HackloteChatApi
2. Testar webhook com pagamento real

## ⚠️ Troubleshooting

### Erro de Conexão
```
Erro: ECONNREFUSED ou ETIMEDOUT
```
**Solução**: Verificar se HackloteChatApi está rodando e acessível

### Erro de Autenticação
```
Erro: Secret interno inválido
```
**Solução**: Verificar se `VERCEL_API_SECRET` é igual nas duas APIs

### Webhook não Recebe Notificações
```
Mercado Pago não está chamando o webhook
```
**Solução**: Verificar URL configurada no Mercado Pago e firewall/proxy

## 📊 Logs e Monitoramento

### Logs Importantes
- ✅ Webhook recebido: `🔔 Webhook Mercado Pago recebido`
- ✅ Pagamento processado: `💰 Detalhes do pagamento obtidos`
- ✅ Highlight aplicado: `✅ Highlight aplicado com sucesso`
- ❌ Erro de comunicação: `❌ Erro ao comunicar com API principal`

### Monitoramento
- Status de saúde: `GET /api/marketplace-webhook/health`
- Logs detalhados no console da HackloteChatApi
- Métricas de sucesso/falha nos logs

## 🎉 Benefícios da Nova Arquitetura

1. **Compatibilidade**: Funciona perfeitamente com webhooks
2. **Confiabilidade**: Servidor dedicado sempre online
3. **Escalabilidade**: Pode processar múltiplos webhooks simultaneamente
4. **Monitoramento**: Logs detalhados e health checks
5. **Flexibilidade**: Fácil de estender para outros tipos de webhook

---

**Status**: ✅ Implementação Completa
**Próximo Passo**: Testar comunicação entre APIs e configurar em produção

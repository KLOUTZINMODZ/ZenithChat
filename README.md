# HackLote Chat API

API WebSocket dedicada para mensagens em tempo real do marketplace HackLote.

## 🚀 Características

- ✅ WebSocket para comunicação em tempo real
- ✅ Criptografia de mensagens end-to-end
- ✅ Persistência no MongoDB
- ✅ Cache com Redis (opcional)
- ✅ Autenticação JWT compatível com a API principal
- ✅ Indicadores de digitação
- ✅ Confirmação de leitura
- ✅ Reconexão automática
- ✅ Fila de mensagens offline

## 📋 Pré-requisitos

- Node.js 16+ 
- MongoDB (mesma instância da API principal)
- Redis (opcional, para cache)
- Token JWT válido da API principal

## 🔧 Instalação

1. **Instalar dependências:**
```bash
cd HackloteChatApi
npm install
```

2. **Configurar variáveis de ambiente:**

Copie o arquivo `.env.example` para `.env` e configure:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações:

```env
# Porta do servidor (padrão: 3001)
PORT=3001

# MongoDB - Use a mesma conexão da API principal
MONGODB_URI=mongodb+srv://seu_usuario:sua_senha@cluster.mongodb.net/hacklote

# JWT Secret - DEVE ser o mesmo da API principal
JWT_SECRET=seu_jwt_secret_aqui

# Origens permitidas (separadas por vírgula)
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174,https://hacklote.vercel.app
```

3. **Criar diretório de logs:**
```bash
mkdir logs
```

## 🏃‍♂️ Executando

### Desenvolvimento:
```bash
npm run dev
```

### Produção:
```bash
npm start
```

O servidor estará disponível em:
- HTTP: `http://12zku8.instatunnel.my`
- WebSocket: `ws://12zku8.instatunnel.my/ws`

## 🔌 Integração com o Frontend

### 1. Configurar URL do WebSocket no Frontend

No arquivo `.env` do frontend:
```env
# Desenvolvimento local
VITE_CHAT_WS_URL=ws://12zku8.instatunnel.my/ws

# Produção (exemplo)
VITE_CHAT_WS_URL=wss://chat-api.hacklote.com/ws
```

### 2. Usar o hook useWebSocket

```typescript
import { useWebSocket } from '@/hooks/useWebSocket';

function ChatComponent() {
  const {
    isConnected,
    conversations,
    messages,
    sendMessage,
    openConversation
  } = useWebSocket();


}
```

## 📡 Endpoints HTTP

### Autenticação
- `POST /api/auth/validate` - Validar token JWT
- `GET /api/auth/ws-token` - Obter URL de conexão WebSocket

### Mensagens
- `GET /api/messages/conversations` - Listar conversas
- `GET /api/messages/conversations/:id/messages` - Obter mensagens
- `POST /api/messages/conversations/:id/messages` - Enviar mensagem (fallback)
- `POST /api/messages/conversations` - Criar/obter conversa
- `PUT /api/messages/conversations/:id/read` - Marcar como lido
- `DELETE /api/messages/:id` - Deletar mensagem

## 🔄 Eventos WebSocket

### Cliente → Servidor
- `message:send` - Enviar mensagem
- `message:typing` - Indicador de digitação
- `message:read` - Marcar como lido
- `conversation:open` - Abrir conversa
- `conversation:close` - Fechar conversa
- `conversation:list` - Listar conversas
- `message:history` - Histórico de mensagens
- `ping` - Heartbeat

### Servidor → Cliente
- `connection` - Conexão estabelecida
- `message:new` - Nova mensagem recebida
- `message:sent` - Confirmação de envio
- `message:typing` - Usuário digitando
- `message:read` - Mensagem lida
- `message:pending` - Mensagens pendentes
- `conversation:list` - Lista de conversas
- `message:history` - Histórico de mensagens
- `error` - Erro
- `pong` - Heartbeat response

## 🔒 Segurança

- Autenticação JWT obrigatória
- Criptografia AES-256-GCM para mensagens
- Rate limiting configurável
- CORS configurável
- Validação de participantes nas conversas

## 📊 Monitoramento

### Health Check
```bash
curl http://12zku8.instatunnel.my/health
```

### Logs
Os logs são salvos em:
- `logs/error.log` - Apenas erros
- `logs/combined.log` - Todos os logs

## 🚀 Deploy

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

### PM2
```bash
pm2 start server.js --name hacklote-chat-api
pm2 save
pm2 startup
```

## 🐛 Troubleshooting

### WebSocket não conecta
1. Verifique se o token JWT é válido
2. Confirme que o JWT_SECRET é o mesmo da API principal
3. Verifique as origens permitidas no CORS

### Mensagens não são salvas
1. Verifique a conexão com MongoDB
2. Confirme que o usuário existe no banco

### Cache não funciona
1. Redis é opcional - o sistema funciona sem ele
2. Se configurado, verifique a conexão Redis

## 📝 Notas Importantes

1. **JWT Secret**: DEVE ser idêntico ao usado na API principal
2. **MongoDB**: Use o mesmo banco de dados da API principal
3. **Usuários**: São sincronizados automaticamente com a API principal
4. **Propostas**: Quando uma proposta é aceita, a conversa é criada automaticamente

## 🤝 Suporte

Para problemas ou dúvidas, abra uma issue no repositório.
# ZenithChat
# ZenithChat

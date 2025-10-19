# 🖼️ Solução para Problema de Hospedagem de Imagens

## 📋 Problema Identificado

As imagens estavam sendo hospedadas temporariamente e depois apareciam como "placeholder-game.jpg" no site.

### Causa Raiz
A API está hospedada no **Vercel** (plataforma serverless), onde:
- ✅ O sistema de arquivos é **efêmero** (temporário)
- ❌ Arquivos salvos na pasta `uploads/` são **deletados** automaticamente
- ❌ Após cada deploy ou timeout, as imagens no disco **desaparecem**
- ⚠️ O frontend mostra placeholder quando a imagem não é encontrada

## 🔧 Solução Implementada

### 1. **Armazenamento Exclusivo no MongoDB**
- Todas as imagens agora são **obrigatoriamente** salvas no MongoDB
- Os buffers são armazenados diretamente no banco de dados
- O disco é usado apenas como cache temporário (opcional)

### 2. **Middleware Aprimorado**
- `imageServeMiddleware.js` agora serve imagens **exclusivamente** do MongoDB
- Logs detalhados para debug
- Retorna 404 com mensagem clara se a imagem não existir

### 3. **Validação Rigorosa**
- Todas as rotas de upload validam os buffers antes de salvar
- Upload falha se não conseguir salvar no MongoDB
- Verificação de integridade após salvamento

## 🚀 Como Resolver o Problema

### Passo 1: Migrar Imagens Existentes
Se você tem imagens antigas no disco que ainda não estão no MongoDB:

```bash
cd HackloteChatApi
node scripts/migrateImagesToMongoDB.js
```

Este script:
- 🔍 Varre toda a pasta `uploads/`
- 📦 Move todas as imagens para o MongoDB
- ✅ Pula imagens que já existem no banco
- 📊 Mostra relatório detalhado

### Passo 2: Verificar Saúde das Imagens
Para verificar se todas as imagens estão corretas no banco:

```bash
node scripts/checkImagesHealth.js
```

Este script:
- 🔍 Verifica integridade de todas as imagens
- ⚠️ Identifica buffers corrompidos ou vazios
- 📊 Mostra estatísticas de tamanho e distribuição
- 📝 Lista imagens com problemas

### Passo 3: Deploy das Alterações
```bash
git add .
git commit -m "fix: Migrar sistema de imagens para MongoDB (Vercel serverless)"
git push
```

O Vercel fará o deploy automaticamente.

## 🔍 Testando

### 1. Upload de Nova Imagem
```bash
# Fazer upload de uma imagem via API
curl -X POST https://sua-api.vercel.app/api/uploads/image \
  -H "Authorization: Bearer SEU_TOKEN" \
  -F "file=@imagem.jpg" \
  -F "conversationId=teste123"
```

### 2. Verificar no MongoDB
```bash
node scripts/checkImagesHealth.js
```

### 3. Acessar a Imagem
```
https://sua-api.vercel.app/uploads/conversationId/2024/10/12345_abc.avif
```

Deve retornar a imagem diretamente do MongoDB.

## 📊 Logs de Debug

O sistema agora gera logs detalhados:

```
[IMAGE_SERVE] Buscando imagem: { imageId: '12345_abc', isThumb: false, isJpeg: false }
[IMAGE_SERVE] Imagem servida do banco: 12345_abc
```

Se uma imagem não for encontrada:
```
[IMAGE_SERVE] Imagem não encontrada no banco: 12345_abc
```

## ⚙️ Configurações Importantes

### MongoDB
Certifique-se de que seu MongoDB tem espaço suficiente:
- Cada imagem ocupa ~200KB-1MB (4 variantes: AVIF full, AVIF thumb, JPEG full, JPEG thumb)
- Para 1000 imagens: ~500MB-1GB de espaço

### Vercel
- **Limite de memória**: 1024MB (configurado em `vercel.json`)
- **Timeout**: 30 segundos (suficiente para processar imagens)

### Variáveis de Ambiente (.env)
```env
MONGODB_URI=mongodb+srv://...
NODE_ENV=production
```

## 🔄 Fluxo de Upload (Após a Correção)

1. **Cliente envia imagem** → API recebe
2. **Sharp processa** → Gera 4 variantes (AVIF/JPEG, full/thumb)
3. **Validação** → Verifica se buffers são válidos
4. **MongoDB** → Salva permanentemente no banco ✅
5. **Disco** → Salva temporariamente (cache opcional, será deletado)
6. **Retorna URLs** → Cliente recebe URLs de acesso

## 🎯 Benefícios da Solução

✅ **Imagens permanentes** - Nunca mais serão perdidas
✅ **Compatível com serverless** - Funciona perfeitamente no Vercel
✅ **Performance** - Cache agressivo (1 ano)
✅ **Escalável** - MongoDB distribui carga automaticamente
✅ **Fallback automático** - JPEG para navegadores sem suporte a AVIF

## 🐛 Troubleshooting

### Problema: Imagens antigas ainda mostram placeholder
**Solução**: Execute o script de migração
```bash
node scripts/migrateImagesToMongoDB.js
```

### Problema: Upload falha com erro "Failed to save to database"
**Solução**: Verifique conexão MongoDB e espaço disponível
```bash
node scripts/checkImagesHealth.js
```

### Problema: Imagem não carrega no frontend
**Solução**: Verifique os logs do servidor
```bash
# Logs do Vercel
vercel logs

# Procure por:
# [IMAGE_SERVE] Imagem não encontrada no banco: XXXXX
```

## 📚 Arquivos Modificados

- `src/middleware/imageServeMiddleware.js` - Serve imagens do MongoDB
- `src/routes/uploadRoutes.js` - Upload obrigatório para MongoDB
- `scripts/migrateImagesToMongoDB.js` - Migração de imagens antigas
- `scripts/checkImagesHealth.js` - Verificação de integridade

## 🔐 Segurança

- ✅ Autenticação obrigatória para upload
- ✅ Validação de tipo de arquivo (apenas AVIF, PNG, JPEG)
- ✅ Limite de tamanho (25MB)
- ✅ CORS configurado corretamente
- ✅ Headers de segurança (HTTPS obrigatório)

## 📞 Suporte

Se o problema persistir após seguir estes passos:
1. Execute `checkImagesHealth.js` e salve o output
2. Verifique os logs do Vercel
3. Confirme que o MongoDB está acessível
4. Verifique se há espaço disponível no MongoDB

---

**Status**: ✅ Problema resolvido - Sistema migrado para MongoDB permanente
**Data**: 2025-10-19
**Versão**: 2.0.0 (MongoDB-based image storage)

# 🔍 Guia de Diagnóstico do Sistema de Imagens

## 📋 Visão Geral

Este guia fornece ferramentas e procedimentos para diagnosticar problemas com o sistema de hospedagem de imagens da API.

---

## 🛠️ Scripts Disponíveis

### 1. **Diagnóstico Completo** - `npm run images:diagnostic`

Analisa detalhadamente uma URL de imagem específica.

**O que faz:**
- ✅ Extrai imageId da URL
- ✅ Busca no MongoDB
- ✅ Verifica buffers
- ✅ Testa regex do middleware
- ✅ Verifica arquivo no disco
- ✅ Fornece diagnóstico e soluções

**Como usar:**
```bash
npm run images:diagnostic
```

**Saída esperada:**
- Status da imagem no banco
- Validade dos buffers
- Análise completa do fluxo

---

### 2. **Listar Imagens** - `npm run images:list`

Lista todas as imagens e busca uma específica.

**O que faz:**
- 📊 Mostra estatísticas gerais
- 📦 Lista 10 imagens mais recentes
- 🔍 Busca imagem específica
- ⚠️ Identifica imagens corrompidas

**Como usar:**
```bash
npm run images:list
```

---

### 3. **Teste de Upload** - `npm run images:test-upload`

Simula um upload completo do início ao fim.

**O que faz:**
- 🎨 Cria imagem de teste
- ⚙️ Processa com Sharp
- 💾 Salva no MongoDB
- 🔍 Verifica integridade
- 🌐 Simula acesso via middleware

**Como usar:**
```bash
npm run images:test-upload
```

**Resultado:**
- Cria uma imagem de teste funcional
- Fornece URL para testar no navegador

---

### 4. **Verificar Saúde** - `npm run images:check`

Verifica integridade de todas as imagens.

**Como usar:**
```bash
npm run images:check
```

---

### 5. **Limpar Corrompidas** - `npm run images:clean`

Remove imagens com buffers vazios/corrompidos.

**Como usar:**
```bash
npm run images:clean
```

---

## 🔧 Procedimento de Diagnóstico

### Problema: `{"success":false,"message":"Image not found"}`

**Passo 1: Executar diagnóstico**
```bash
npm run images:diagnostic
```

**Passo 2: Analisar resultado**

#### ❌ Se "Imagem NÃO ESTÁ NO BANCO":
```bash
# Verificar se existe no disco
npm run images:list

# Migrar do disco para MongoDB
npm run images:migrate
```

#### ❌ Se "Buffer VAZIO/CORROMPIDO":
```bash
# Limpar imagens corrompidas
npm run images:clean

# Fazer novo upload da imagem
```

#### ✅ Se "Sistema funcionando corretamente":
```bash
# Problema pode estar no middleware ou servidor
# Verificar:
# 1. Servidor está rodando?
# 2. URL está correta?
# 3. Middleware está ativo?
```

**Passo 3: Testar upload novo**
```bash
npm run images:test-upload
```

---

## 🏗️ Arquitetura do Sistema

```
┌─────────────────┐
│   Upload API    │
│  /api/uploads   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Sharp Process  │
│ - Resize        │
│ - AVIF/JPEG     │
│ - Thumbnails    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MongoDB Save   │
│ - fullImage     │
│ - thumbImage    │
│ - fullImageJpeg │
│ - thumbImageJpeg│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Access /uploads│
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  imageServeMiddleware       │
│  1. Extract imageId         │
│  2. Find in MongoDB         │
│  3. Return buffer           │
└─────────────────────────────┘
```

---

## 📝 Estrutura da URL

### Padrão:
```
/uploads/{tipo}/{ano}/{mes}/{imageId}.{extensão}
```

### Exemplos:
```
/uploads/marketplace/2025/10/1760889095249_ve5m4a7ykn.avif
/uploads/marketplace/2025/10/1760889095249_ve5m4a7ykn_thumb.avif
/uploads/123abc/2025/10/1760889095249_ve5m4a7ykn.jpg
```

### Componentes:
- **tipo**: `marketplace` ou `conversationId`
- **ano**: 4 dígitos
- **mes**: 1-12
- **imageId**: `TIMESTAMP_RANDOM` (ex: `1760889095249_ve5m4a7ykn`)
- **extensão**: `avif` ou `jpg`/`jpeg`

---

## 🔍 Validação de ImageId

### Regex usado:
```javascript
/^(\d+_[a-z0-9]+)(?:_thumb)?\.(?:avif|jpg|jpeg|png)$/i
```

### Exemplos válidos:
- ✅ `1760889095249_ve5m4a7ykn.avif`
- ✅ `1760889095249_ve5m4a7ykn_thumb.avif`
- ✅ `1760889095249_ve5m4a7ykn.jpg`

### Exemplos inválidos:
- ❌ `image.avif` (falta timestamp e ID)
- ❌ `1760889095249.avif` (falta ID aleatório)
- ❌ `abc_def.avif` (timestamp deve ser numérico)

---

## 🐛 Problemas Comuns

### 1. Imagem não encontrada (404)

**Causa**: Imagem não está no MongoDB

**Solução**:
```bash
npm run images:list          # Verificar se existe
npm run images:migrate       # Migrar do disco
# OU fazer novo upload
```

---

### 2. Buffer vazio/corrompido

**Causa**: Falha no processamento durante upload

**Solução**:
```bash
npm run images:clean         # Remover corrompidas
# Fazer novo upload da imagem
```

---

### 3. Regex não reconhece o arquivo

**Causa**: Nome do arquivo não segue o padrão

**Verificar**:
- Timestamp numérico no início
- ID aleatório após underscore
- Extensão válida (.avif, .jpg, .jpeg, .png)

---

### 4. Erro ao acessar URL

**Causas possíveis**:
1. Servidor não está rodando
2. Middleware não está ativo
3. URL incorreta
4. Problema de CORS

**Verificar**:
```bash
# Ver se servidor está rodando
curl http://localhost:5000/

# Testar URL da imagem
curl -I http://localhost:5000/uploads/marketplace/2025/10/IMAGEID.avif
```

---

## 📊 Logs de Exemplo

### Upload bem-sucedido:
```
POST /api/uploads/marketplace-image
✅ Buffer validado
✅ Salvo no MongoDB
✅ ImageId: 1760889095249_ve5m4a7ykn
```

### Acesso bem-sucedido:
```
GET /uploads/marketplace/2025/10/1760889095249_ve5m4a7ykn.avif
✅ Encontrado no MongoDB
✅ Buffer servido: 45.23 KB
```

### Erro comum:
```
GET /uploads/marketplace/2025/10/1760889095249_ve5m4a7ykn.avif
❌ Imagem não encontrada no banco
❌ 404 Image not found
```

---

## 🔐 Variáveis de Ambiente Necessárias

```env
MONGODB_URI=mongodb://...
CHAT_PUBLIC_BASE_URL=https://zenith.enrelyugi.com.br
```

---

## 🚀 Deploy e Produção

### Vercel/Serverless:
- ✅ Usa apenas MongoDB (disco é efêmero)
- ✅ Sem salvamento em disco
- ✅ Buffers persistentes

### Desenvolvimento local:
- ✅ MongoDB como prioridade
- ✅ Disco como fallback (opcional)

---

## 📞 Suporte

Se os scripts não resolverem:

1. Verifique logs do servidor
2. Verifique conexão com MongoDB
3. Teste com imagem nova
4. Verifique middlewares em `server.js`

---

## 🎯 Checklist Rápido

- [ ] `npm run images:diagnostic` executado
- [ ] `npm run images:list` verificado
- [ ] `npm run images:clean` se necessário
- [ ] `npm run images:test-upload` criou imagem teste
- [ ] URL de teste funcionando
- [ ] Novo upload funciona
- [ ] Servidor reiniciado

---

**Última atualização**: Janeiro 2025
**Versão**: 2.0

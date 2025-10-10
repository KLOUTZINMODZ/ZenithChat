# Sistema de Persistência de Imagens no Banco de Dados

## 📋 Visão Geral

Implementado sistema robusto de persistência de imagens no MongoDB para garantir que **nenhuma imagem seja perdida**, mesmo se arquivos no disco forem deletados. O sistema mantém **100% de compatibilidade** com URLs existentes no frontend.

---

## 🎯 Problema Resolvido

**Antes:**
- Imagens salvas apenas no disco (`/uploads`)
- Imagens sumindo (404) quando arquivos eram deletados
- Sem backup ou redundância

**Depois:**
- Imagens salvas no MongoDB (permanente)
- Imagens também salvas no disco (compatibilidade)
- Middleware inteligente com fallback automático
- URLs continuam funcionando sem mudanças no frontend

---

## 🏗️ Arquitetura Implementada

### **1. Modelo de Banco de Dados**
**Arquivo:** `src/models/UploadedImage.js`

```javascript
{
  imageId: String,              // ID único (ex: 1735938234_abc123)
  conversationId: String,        // Conversa associada
  
  // Buffers das imagens (nunca serão deletados)
  fullImage: Buffer,            // AVIF full (1920x1920)
  thumbImage: Buffer,           // AVIF thumb (512x512)
  fullImageJpeg: Buffer,        // JPEG fallback full
  thumbImageJpeg: Buffer,       // JPEG fallback thumb
  
  // Metadados
  metadata: {
    originalName: String,
    originalSize: Number,
    originalMimeType: String,
    width: Number,
    height: Number
  },
  
  // URLs originais (compatibilidade)
  urls: {
    full: String,               // /uploads/conv/2024/1/image.avif
    thumb: String,
    fullJpeg: String,
    thumbJpeg: String
  },
  
  uploadedBy: ObjectId,
  uploadedAt: Date,
  permanent: Boolean (default: true) // Flag para NUNCA deletar
}
```

**Índices:**
- `imageId` (unique)
- `conversationId` + `uploadedAt`

---

### **2. Rotas de Upload Modificadas**
**Arquivo:** `src/routes/uploadRoutes.js`

**POST `/api/upload/image`** (multipart/form-data)
**POST `/api/upload/image-base64`** (JSON base64)

**Fluxo:**
1. Recebe imagem
2. Processa com Sharp (4 versões)
3. **Salva no disco** (compatibilidade com sistema antigo)
4. **Salva no MongoDB** (persistência garantida)
5. Retorna URLs normais

```javascript
// Ambas rotas salvam no banco de dados
await UploadedImage.create({
  imageId: baseName,
  conversationId: conversationId,
  fullImage: fullBuffer,        // ~200KB AVIF
  thumbImage: thumbBuffer,      // ~50KB AVIF
  fullImageJpeg: fullJpegBuffer,  // ~400KB JPEG
  thumbImageJpeg: thumbJpegBuffer, // ~100KB JPEG
  metadata: { ... },
  urls: { ... },
  permanent: true  // NUNCA SERÁ DELETADA
});
```

---

### **3. Middleware de Servir Imagens**
**Arquivo:** `src/middleware/imageServeMiddleware.js`

**Estratégia de Fallback:**
```
Requisição → Middleware → MongoDB? → Disco? → 404
                           ✓ Serve      ✓ Serve
```

**Funcionamento:**
1. Intercepta `/uploads/**/*.{avif,jpg,jpeg,png}`
2. Extrai `imageId` da URL
3. Busca no MongoDB primeiro
4. Se encontrar: serve do banco (Buffer)
5. Se não encontrar: `next()` → express.static serve do disco
6. Cache agressivo: 1 ano

**Vantagens:**
- Zero mudanças no frontend
- URLs antigas continuam funcionando
- Imagens novas sempre persistidas
- Performance otimizada com cache

---

### **4. Configuração do Server**
**Arquivo:** `server.js`

```javascript
// ORDEM IMPORTA!
app.use('/uploads', imageServeMiddleware);  // 1º: tenta banco
app.use('/uploads', express.static(...));   // 2º: fallback disco
```

---

## 📊 Estatísticas de Armazenamento

**Por imagem:**
- Full AVIF: ~150-250KB
- Thumb AVIF: ~40-60KB
- Full JPEG: ~300-500KB
- Thumb JPEG: ~80-120KB
- **Total por upload: ~570KB-930KB**

**Exemplo com 1.000 imagens:**
- Tamanho médio: ~750KB/imagem
- Total: ~750MB
- MongoDB suporta até 16MB por documento
- GridFS não necessário (cada imagem < 1MB)

---

## 🔄 Fluxo Completo

### **Upload:**
```
Frontend → POST /api/upload/image
           ↓
        Sharp processa (4 versões)
           ↓
        ├─→ Disco: /uploads/conv/2024/1/img.avif
        └─→ MongoDB: UploadedImage.create({...})
           ↓
        Retorna: { url: "/uploads/conv/2024/1/img.avif" }
```

### **Acesso:**
```
Frontend → GET /uploads/conv/2024/1/img.avif
           ↓
        Middleware intercepta
           ↓
        MongoDB busca imageId
           ├─→ Encontrou? → Serve buffer (Cache 1 ano)
           └─→ Não? → express.static serve do disco
```

---

## ✅ Garantias

### **1. Persistência Total**
- ✅ Imagens NUNCA são deletadas do MongoDB
- ✅ Flag `permanent: true` em todos documentos
- ✅ Sem TTL ou cleanup automático

### **2. Compatibilidade**
- ✅ URLs antigas funcionam (disco)
- ✅ URLs novas funcionam (banco)
- ✅ Zero mudanças no frontend
- ✅ Fallback automático

### **3. Performance**
- ✅ Cache agressivo (1 ano)
- ✅ ETag e Last-Modified
- ✅ Buffers otimizados
- ✅ `.lean()` nas queries

### **4. Redundância**
- ✅ Disco + Banco = 2 cópias
- ✅ Se disco falhar → banco serve
- ✅ Se banco falhar → disco serve

---

## 🚀 Próximos Passos (Opcional)

1. **Migração de Imagens Antigas:**
   - Script para importar imagens do disco para o banco
   - Arquivo: `scripts/migrateOldImages.js`

2. **Limpeza de Disco (Futuro):**
   - Após confirmar que todas imagens estão no banco
   - Deletar arquivos antigos do disco
   - Economizar espaço

3. **Métricas:**
   - Quantas imagens no banco
   - Taxa de hit/miss do middleware
   - Tamanho total usado

---

## 📝 Logs

**Upload bem-sucedido:**
```
[UPLOAD] Image saved to database: 1735938234_abc123
```

**Serviço do banco:**
```
[IMAGE_SERVE] Servindo do banco de dados: 1735938234_abc123 (245.3KB)
```

**Fallback para disco:**
```
[IMAGE_SERVE] Não encontrado no BD, tentando disco: 1735938234_abc123
```

---

## 🛡️ Segurança

- ✅ URLs assinadas com timestamp + random
- ✅ Validação de MIME types
- ✅ Limite de 8MB por arquivo
- ✅ CORS configurado
- ✅ Sanitização de paths

---

## 🔧 Manutenção

**Verificar imagens no banco:**
```javascript
const count = await UploadedImage.countDocuments();
console.log(`Total de imagens persistidas: ${count}`);
```

**Buscar imagem específica:**
```javascript
const img = await UploadedImage.findOne({ imageId: '1735938234_abc123' });
```

**Estatísticas de tamanho:**
```javascript
const stats = await UploadedImage.aggregate([
  {
    $project: {
      totalSize: {
        $add: [
          { $bsonSize: "$fullImage" },
          { $bsonSize: "$thumbImage" },
          { $bsonSize: "$fullImageJpeg" },
          { $bsonSize: "$thumbImageJpeg" }
        ]
      }
    }
  },
  {
    $group: {
      _id: null,
      avgSize: { $avg: "$totalSize" },
      totalSize: { $sum: "$totalSize" }
    }
  }
]);
```

---

## ✨ Resultado Final

**🎯 Objetivo Alcançado:**
- ✅ Imagens **NUNCA** serão perdidas
- ✅ Sistema 100% retrocompatível
- ✅ Frontend continua funcionando sem mudanças
- ✅ Redundância disco + banco
- ✅ Performance otimizada
- ✅ Logs detalhados

**🚀 Deploy:**
Basta reiniciar o servidor. O sistema começa a funcionar imediatamente para novos uploads!

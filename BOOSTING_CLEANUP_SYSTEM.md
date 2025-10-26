# Sistema de Limpeza Automática de Pedidos de Boosting

## 📋 Visão Geral

Sistema automatizado que deleta pedidos de boosting **sem propostas aceitas** após **3 dias** de criação.

⚠️ **Aviso ao Usuário:** "CASO NENHUM LANCE FOR ACEITO EM ATÉ 3 DIAS O PEDIDO DE BOOSTING VAI SER EXCLUÍDO."

---

## 🎯 Funcionalidades

### 1. **CleanupService** (Serviço Automatizado)
- ✅ Executa automaticamente via `node-cron`
- ✅ Job diário às 03:00 AM (horário de Brasília)
- ✅ Verificação rápida a cada 6 horas
- ✅ Inicia automaticamente com o servidor
- ✅ Graceful shutdown integrado

### 2. **cleanExpiredBoostings.js** (Script Manual)
- ✅ Execução manual para testes/manutenção
- ✅ Relatório detalhado de operações
- ✅ Verificação de segurança antes de deletar

---

## 🔍 Critérios de Exclusão

Um pedido de boosting é deletado quando **TODAS** as condições são verdadeiras:

1. ✅ Criado há mais de **3 dias**
2. ✅ Status é `'open'` (aberto)
3. ✅ **Não possui** proposta aceita no MongoDB local
4. ✅ **Não possui** propostas pendentes/aceitas na API principal

---

## 🚀 Configuração

### Variáveis de Ambiente
```env
# URL da API principal para verificar propostas
HACKLOTE_API_URL=https://zenithggapi.vercel.app/api

# MongoDB Connection
MONGODB_URI=mongodb://...
```

### Schedules dos Jobs
```javascript
// Job principal: Todo dia às 03:00 AM
'0 3 * * *'  

// Verificação rápida: A cada 6 horas
'0 */6 * * *'
```

---

## 🛠️ Uso

### Execução Manual
```bash
# Via npm script
npm run boosting:clean-expired

# Direto
node scripts/cleanExpiredBoostings.js
```

### Logs de Exemplo
```
🚀 Iniciando limpeza de pedidos de boosting expirados
⏰ Data limite: 3 dias atrás

✅ Conectado ao MongoDB
🔍 Buscando pedidos de boosting criados antes de 2025-01-23T10:30:00.000Z
📊 Encontrados 5 pedidos expirados

⏭️  Pedido 60a7b8c3... possui proposta aceita, mantendo...
⏭️  Pedido 60a7b8c4... possui propostas pendentes na API, mantendo...
🗑️  Deletando pedido 60a7b8c5... (criado em 2025-01-20T10:30:00.000Z)
  ✅ Deletado da API principal
  ✅ Deletado do MongoDB local

📊 Resumo:
   - Pedidos verificados: 5
   - Pedidos deletados: 1
   - Pedidos mantidos: 4

✅ Limpeza concluída com sucesso!
```

---

## 📂 Arquivos Criados

### 1. `/scripts/cleanExpiredBoostings.js`
Script standalone para execução manual de limpeza.

**Funcionalidades:**
- Conexão ao MongoDB
- Busca de pedidos expirados
- Verificação de propostas (local e API)
- Deleção segura (API + MongoDB)
- Relatório detalhado

### 2. `/src/services/CleanupService.js`
Serviço de limpeza automática com cron jobs.

**Funcionalidades:**
- Job diário (03:00 AM)
- Verificação a cada 6 horas
- Start/Stop para graceful shutdown
- Execução manual via `runManually()`

### 3. Integração no `server.js`
```javascript
const cleanupService = require('./src/services/CleanupService');

// Inicia com o servidor
cleanupService.start();

// Para no shutdown
cleanupService.stop();
```

---

## 🔐 Segurança

### Verificações de Segurança
1. ✅ Verifica propostas aceitas no MongoDB local
2. ✅ Verifica propostas pendentes na API principal
3. ✅ Deleta da API principal **antes** do MongoDB
4. ✅ Se falhar verificação na API, **não deleta**
5. ✅ Logs detalhados de todas as operações

### Proteções
- ❌ **Não deleta** se houver proposta aceita
- ❌ **Não deleta** se houver proposta pendente
- ❌ **Não deleta** se status não for 'open'
- ❌ **Não deleta** se falhar verificação na API

---

## 🧪 Testes

### Testar Limpeza Manual
```bash
# 1. Executar script
npm run boosting:clean-expired

# 2. Verificar logs
# Deve mostrar pedidos verificados e deletados
```

### Testar Serviço Automático
```bash
# 1. Iniciar servidor
npm run dev

# 2. Verificar logs de inicialização
# Deve mostrar: "✅ Cleanup service started (boosting expiration)"

# 3. Verificar execução dos jobs
# Jobs executam às 03:00 AM e a cada 6 horas
```

---

## 📊 Monitoramento

### Logs do Serviço
```
✅ CleanupService iniciado com sucesso!
📅 Jobs agendados:
   - boosting-cleanup: 0 3 * * *
   - quick-check: 0 */6 * * *
```

### Logs de Execução
```
🔄 [CleanupService] Executando limpeza de pedidos de boosting...
   📊 Encontrados 10 pedidos expirados para verificar
   🗑️  Pedido 60a7b8c5... deletado (criado em 2025-01-20T10:30:00.000Z)
✅ [CleanupService] Limpeza concluída: 1 pedidos deletados
```

---

## 🔧 Manutenção

### Ajustar Período de Expiração
```javascript
// Em CleanupService.js e cleanExpiredBoostings.js
const EXPIRATION_DAYS = 3; // Alterar para número desejado
```

### Ajustar Horário dos Jobs
```javascript
// Em CleanupService.js
// Formato: minuto hora dia mês dia-da-semana
const boostingCleanupJob = cron.schedule('0 3 * * *', ...);  // 03:00 AM
const quickCheckJob = cron.schedule('0 */6 * * *', ...);     // A cada 6 horas
```

### Desabilitar Verificação Rápida
```javascript
// Comentar ou remover o quickCheckJob em CleanupService.js
```

---

## ⚠️ Avisos Importantes

1. **Backup:** Recomendado fazer backup antes de executar limpeza manual
2. **Horário:** Jobs executam no horário de Brasília (`America/Sao_Paulo`)
3. **API:** Requer conectividade com a API principal para verificações
4. **Segurança:** Nunca deleta pedidos com propostas aceitas/pendentes

---

## 📝 TODO / Melhorias Futuras

- [ ] Dashboard para visualizar pedidos a serem deletados
- [ ] Notificação ao usuário antes da deleção (ex: 24h antes)
- [ ] Métricas de limpeza (Prometheus/Grafana)
- [ ] Soft delete (marcar como deletado ao invés de remover)
- [ ] Configuração via painel admin

---

## 🆘 Troubleshooting

### Job não está executando
```bash
# Verificar se o serviço está rodando
# Deve aparecer nos logs: "✅ Cleanup service started"

# Verificar timezone
# Jobs usam timezone: America/Sao_Paulo
```

### Pedidos não estão sendo deletados
```bash
# 1. Executar manualmente para ver logs detalhados
npm run boosting:clean-expired

# 2. Verificar se há propostas aceitas/pendentes
# 3. Verificar conectividade com a API principal
# 4. Verificar status do pedido (deve ser 'open')
```

### Erro ao conectar na API
```bash
# Verificar HACKLOTE_API_URL no .env
# Verificar se a API está acessível
curl https://zenithggapi.vercel.app/api/health
```

---

## 📞 Suporte

Para dúvidas ou problemas:
1. Verificar logs do servidor
2. Executar script manual para diagnóstico
3. Verificar configurações de ambiente
4. Revisar este documento

---

**Última Atualização:** 26 de Outubro de 2025
**Versão:** 1.0.0

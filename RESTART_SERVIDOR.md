# 🔄 Como Reiniciar o Servidor Chat API

## 🚨 IMPORTANTE
As alterações em `src/routes/proposalRoutes.js` **NÃO** terão efeito até que o servidor seja reiniciado!

---

## 📋 Métodos de Restart

### **Método 1: Via SSH (Recomendado)**

```bash
# 1. Conecte ao servidor
ssh usuario@zenith.enrelyugi.com.br

# 2. Vá para o diretório do projeto
cd /caminho/para/ZenithChat

# 3. Reinicie com PM2
pm2 restart ZenithChat

# 4. Verifique os logs
pm2 logs ZenithChat --lines 50
```

---

### **Método 2: Se não usar PM2**

```bash
# 1. Encontre o processo
ps aux | grep node

# 2. Mate o processo (substitua PID pelo ID do processo)
kill -9 PID

# 3. Inicie novamente
npm start
# OU
node src/server.js
```

---

### **Método 3: Restart automático (se usar nodemon)**

Se o servidor estiver rodando com `nodemon`, as mudanças serão aplicadas automaticamente.

```bash
# Verifique se está usando nodemon
ps aux | grep nodemon

# Se sim, apenas salve o arquivo e ele reinicia sozinho
```

---

## ✅ Como Verificar Se Reiniciou

Após reiniciar, tente aceitar a proposta novamente e **verifique os logs no servidor**.

Você deverá ver:

```
🔍 [Proposal Accept] Received request for proposal: ...
🔍 [Proposal Accept] BoosterId (normalized): 6897d82c8cdd40188e08a224
🔍 [Proposal Accept] ClientId (normalized): 68a27017da1e592e29195df1
🔍 [Proposal Accept] ProposalId is composite format, need to find real proposal ID
🔗 [Proposal Accept] Fetching proposals from: https://zenithapi-steel.vercel.app/api/boosting-requests/68ee950477bab05ae3f000d0/proposals
✅ [Proposal Accept] Found 1 proposals for boosting 68ee950477bab05ae3f000d0
✅ [Proposal Accept] Found matching proposal ID: {REAL_ID} for booster 6897d82c8cdd40188e08a224
🔗 [Proposal Accept] Forwarding to: https://zenithapi-steel.vercel.app/api/boosting-requests/.../proposals/{REAL_ID}/accept
```

---

## 🐛 Se Continuar com Erro 404

### **Possível Causa 1: Servidor não reiniciou**
- Certifique-se de que o processo foi realmente reiniciado
- Verifique o timestamp dos logs (deve ser recente)

### **Possível Causa 2: Código não foi enviado ao servidor**
```bash
# No servidor
cd /caminho/para/ZenithChat
git pull origin main
npm install  # Se houver novas dependências
pm2 restart ZenithChat
```

### **Possível Causa 3: Rota não existe na API principal**
A rota que o Chat API está tentando chamar é:
```
GET /api/boosting-requests/{boostingId}/proposals
```

Se a API principal não tiver essa rota, precisaremos implementá-la.

---

## 🔍 Debug Avançado

### **Ver todos os processos PM2:**
```bash
pm2 list
```

### **Ver logs em tempo real:**
```bash
pm2 logs ZenithChat
```

### **Ver informações do processo:**
```bash
pm2 info ZenithChat
```

### **Restart forçado:**
```bash
pm2 delete ZenithChat
pm2 start ecosystem.config.js
# OU
pm2 start src/server.js --name ZenithChat
```

---

## 📝 Checklist de Troubleshooting

- [ ] Arquivo `proposalRoutes.js` foi salvo
- [ ] Código foi enviado ao servidor (git push)
- [ ] Servidor foi acessado via SSH
- [ ] Comando de restart foi executado
- [ ] Logs mostram timestamp recente
- [ ] Logs mostram nova lógica sendo executada
- [ ] Frontend foi recarregado (Ctrl+R)
- [ ] Tentativa de aceitar proposta foi feita novamente

---

## 🚀 Alternativa: Deploy Automático

Se seu servidor usar **CI/CD** (GitHub Actions, etc.), você pode:

1. **Commitar as mudanças:**
```bash
git add src/routes/proposalRoutes.js
git commit -m "fix: Corrige busca de proposalId real na API principal"
git push origin main
```

2. **Aguardar deploy automático** (se configurado)

3. **Testar após deploy concluir**

---

## ⚠️ ATENÇÃO

**O erro 404 continuará acontecendo até que o servidor seja reiniciado!**

Sem o restart, o código antigo (que não busca o ID real) continuará sendo executado.

---

**Status Atual:** ⏳ Aguardando restart do servidor  
**Próximo Passo:** Acessar servidor via SSH e executar `pm2 restart ZenithChat`  
**Verificação:** Logs devem mostrar nova lógica de busca de propostas

---

**Criado em:** 14/10/2025  
**Arquivos Modificados:** `src/routes/proposalRoutes.js` (linhas 47-193)

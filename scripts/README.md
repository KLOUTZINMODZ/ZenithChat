# 🛠️ Scripts de Manutenção - HackloteChat API

Este diretório contém scripts de manutenção e migração para o banco de dados.

---

## 📋 Scripts Disponíveis

### 1. `fix-blocked-escrows.js` ✨

**Descrição**: Corrige escrows (saldo bloqueado) de serviços de boosting cancelados que não foram devolvidos aos clientes.

**Problema resolvido**: Quando um serviço era cancelado, o saldo bloqueado (escrow) não estava sendo devolvido ao cliente, deixando o saldo "preso" indefinidamente.

#### 🚀 Como Usar

##### Opção 1: Executar diretamente (Node.js)

```bash
# No diretório raiz da HackloteChatApi
node scripts/fix-blocked-escrows.js
```

O script irá:
1. Fazer uma **auditoria** (mostrar quantos escrows estão bloqueados)
2. Fazer um **dry run** (simular correção sem alterar nada)
3. Perguntar se deseja aplicar as correções

##### Opção 2: Usar via código (Node.js)

```javascript
const { fixBlockedEscrows, auditBlockedEscrows } = require('./scripts/fix-blocked-escrows');

// Apenas auditar (ver quantos estão bloqueados)
await auditBlockedEscrows();

// Dry run (simular)
await fixBlockedEscrows({ dryRun: true });

// Aplicar correções
await fixBlockedEscrows({ dryRun: false, limit: 50 });
```

##### Opção 3: MongoDB Atlas/Compass

Copie e cole a função `fixBlockedEscrows` no console do MongoDB e execute:

```javascript
// Copiar funções auxiliares e a função principal
// Depois executar:
fixBlockedEscrows();
```

#### ⚙️ Opções

| Opção | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `dryRun` | boolean | `false` | Se `true`, apenas simula sem fazer alterações |
| `startDate` | Date | `2024-01-01` | Data inicial para buscar agreements cancelados |
| `limit` | number | `100` | Máximo de agreements para processar por vez |

#### 📊 Exemplo de Saída

```
🔍 Auditoria de Escrows Bloqueados

❌ Agreement 673abc123: R$ 5.00 bloqueado
❌ Agreement 673def456: R$ 10.50 bloqueado
❌ Agreement 673ghi789: R$ 3.75 bloqueado

============================================================
📊 Total de escrows bloqueados: 3
💰 Valor total bloqueado: R$ 19.25
============================================================

🔄 Executando DRY RUN...

🔧 Agreement 673abc123:
   Cliente: 690d2ae227a62233ee25083a
   Valor bloqueado: R$ 5.00
   [DRY RUN] Seria devolvido R$ 5.00 ao cliente

============================================================
📊 RESUMO DA EXECUÇÃO
============================================================
✅ Corrigidos: 3
✔️  Já corrigidos: 0
ℹ️  Sem escrow: 0
❌ Erros: 0
📋 Total processado: 3
============================================================

⚠️  Este foi um DRY RUN. Nenhuma alteração foi feita.
```

#### 🔐 Segurança

- ✅ **Transações atômicas**: Usa `runTx()` para garantir consistência
- ✅ **Dry run por padrão**: Primeiro mostra o que seria feito
- ✅ **Idempotente**: Não devolve duas vezes o mesmo escrow
- ✅ **Logs detalhados**: Registra todas as operações
- ✅ **Rollback automático**: Se falhar, não altera nada

#### ⚠️ Avisos

- **SEMPRE** execute um dry run primeiro
- **SEMPRE** faça backup do banco antes de executar em produção
- **SEMPRE** verifique os logs para confirmar as correções
- Execute em **horário de baixo tráfego** se possível

---

## 🧪 Testes

Para testar o script em ambiente de desenvolvimento:

```bash
# 1. Criar agreement cancelado de teste
# 2. Criar escrow sem refund
# 3. Executar o script
node scripts/fix-blocked-escrows.js

# 4. Verificar no banco se o escrow foi devolvido
db.walletledgers.find({
  reason: 'boosting_escrow_refund',
  'metadata.migration': true
}).sort({ createdAt: -1 });
```

---

## 📚 Documentação Relacionada

- `../FIX_ESCROW_BLOCKED_BALANCE.md` - Documentação completa do problema e solução
- `../REALTIME_ESCROW_UPDATES.md` - Sistema de atualização de saldo em tempo real
- `../src/controllers/boostingChatController.js` - Código corrigido do cancelService

---

## 🤝 Contribuindo

Ao adicionar novos scripts:
1. Adicione documentação neste README
2. Inclua opção de dry run
3. Use transações atômicas
4. Adicione logs detalhados
5. Documente as mudanças no banco

---

**Última atualização**: 10 de Novembro de 2025  
**Versão**: 1.0

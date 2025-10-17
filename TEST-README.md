# 🧪 Script de Teste do Sistema de Email

Este script testa completamente o sistema de gerenciamento de emails do Zenith Gaming.

## 📋 Pré-requisitos

- Node.js instalado
- Acesso à API do Zenith
- Admin Key válida

## 🚀 Como Usar

### 1. Configure a Admin Key

Abra o arquivo `test-email-system.js` e substitua a linha:

```javascript
const ADMIN_KEY = 'sua_admin_key_aqui';
```

Pela sua admin key real. Você pode encontrá-la no localStorage do navegador quando logado no painel admin.

### 2. Execute o Script

No terminal, navegue até a pasta da API e execute:

```bash
node test-email-system.js
```

## 🔍 O Que o Script Testa

### ✅ Teste 1: Conexão com API
- Verifica se a API está acessível
- Valida autenticação com Admin Key
- Confirma status HTTP 200

### ✅ Teste 2: Estatísticas de Email
- Busca estatísticas gerais de usuários
- Exibe total de usuários elegíveis e não elegíveis
- Mostra breakdown detalhado por tipo de valor

### ✅ Teste 3: Debug Detalhado de Usuários
- Lista todos os usuários com suas preferências
- Mostra valor e tipo de `emailNotifications`
- Identifica quem é elegível e por quê

### ✅ Teste 4: Validação de Lógica
- Verifica consistência entre endpoints
- Valida soma do breakdown
- Confirma que apenas `true` explícito = elegível

## 📊 Exemplo de Saída

```
╔═══════════════════════════════════════════════════════════╗
║     TESTE DO SISTEMA DE EMAIL - ZENITH GAMING           ║
╚═══════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════
TESTE 1: Conexão com API
═══════════════════════════════════════════════════════════

✓ Conexão estabelecida com sucesso!
→ Status Code: 200

═══════════════════════════════════════════════════════════
TESTE 2: Estatísticas de Email
═══════════════════════════════════════════════════════════

✓ Estatísticas obtidas com sucesso!

📊 ESTATÍSTICAS:
   Total de usuários: 43
   Elegíveis: 0
   Não elegíveis: 43

📋 BREAKDOWN:
   ✅ true explícito: 0
   ❌ false explícito: 0
   ⚪ undefined: 43
   ⚫ null: 0
   🚫 sem preferences: 0

[... mais testes ...]

═══════════════════════════════════════════════════════════
RESUMO FINAL DOS TESTES
═══════════════════════════════════════════════════════════

RESULTADOS:
✓ Conexão com API
✓ Estatísticas de Email
✓ Debug de Usuários
✓ Validação de Lógica

🎉 TODOS OS TESTES PASSARAM!
```

## 🐛 Problemas Comuns

### ❌ Erro de Autenticação (401/403)
**Causa:** Admin Key inválida ou ausente  
**Solução:** Verifique se copiou a Admin Key corretamente

### ❌ Erro de Conexão (ENOTFOUND)
**Causa:** URL da API incorreta ou servidor offline  
**Solução:** Verifique se a API está rodando em `zenith.enrelyugi.com.br`

### ❌ Testes de Validação Falhando
**Causa:** Inconsistência entre endpoints  
**Solução:** Verifique os logs da API para detalhes

## 📝 Notas

- O script NÃO modifica dados, apenas lê
- Todos os testes são seguros para executar em produção
- Os logs coloridos ajudam a identificar problemas rapidamente

## 🔧 Customização

Você pode modificar o script para:
- Testar outros endpoints
- Adicionar mais validações
- Criar usuários de teste
- Executar testes de carga

## 📞 Suporte

Se encontrar problemas, verifique:
1. Logs da API no servidor
2. Console do navegador no painel admin
3. Configuração da Admin Key

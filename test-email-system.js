/**
 * Script de Teste do Sistema de Email
 * 
 * Execute com: node test-email-system.js
 * 
 * Este script testa:
 * 1. Conexão com a API
 * 2. Endpoint de estatísticas de email
 * 3. Endpoint de debug de usuários
 * 4. Criação de usuários de teste com diferentes valores
 */

const https = require('https');

// Configurações
const API_URL = 'zenith.enrelyugi.com.br';
const ADMIN_KEY = 'Kl0u7s2llaHu'; // SUBSTITUA PELA SUA ADMIN KEY

// Cores para console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Função auxiliar para fazer requisições
function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_URL,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_KEY
      }
    };

    const req = https.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(body);
          resolve({ statusCode: res.statusCode, data: jsonData });
        } catch (error) {
          resolve({ statusCode: res.statusCode, data: body });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Função para imprimir header
function printHeader(text) {
  console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset);
  console.log(colors.cyan + colors.bright + text + colors.reset);
  console.log(colors.cyan + colors.bright + '═'.repeat(60) + colors.reset + '\n');
}

// Função para imprimir sucesso
function printSuccess(text) {
  console.log(colors.green + '✓ ' + text + colors.reset);
}

// Função para imprimir erro
function printError(text) {
  console.log(colors.red + '✗ ' + text + colors.reset);
}

// Função para imprimir info
function printInfo(text) {
  console.log(colors.blue + '→ ' + text + colors.reset);
}

// Função para imprimir warning
function printWarning(text) {
  console.log(colors.yellow + '⚠ ' + text + colors.reset);
}

// Teste 1: Conexão com API
async function testConnection() {
  printHeader('TESTE 1: Conexão com API');
  
  try {
    const response = await makeRequest('/api/admin/email-stats');
    
    if (response.statusCode === 200) {
      printSuccess('Conexão estabelecida com sucesso!');
      printInfo(`Status Code: ${response.statusCode}`);
      return true;
    } else if (response.statusCode === 401 || response.statusCode === 403) {
      printError('Falha na autenticação!');
      printWarning('Verifique se a ADMIN_KEY está correta no script');
      return false;
    } else {
      printError(`Status Code inesperado: ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    printError('Erro ao conectar com a API: ' + error.message);
    return false;
  }
}

// Teste 2: Estatísticas de Email
async function testEmailStats() {
  printHeader('TESTE 2: Estatísticas de Email');
  
  try {
    const response = await makeRequest('/api/admin/email-stats');
    
    if (response.statusCode === 200 && response.data.success) {
      const stats = response.data.stats;
      const analysis = response.data.analysis;
      
      printSuccess('Estatísticas obtidas com sucesso!');
      console.log('');
      console.log(colors.bright + '📊 ESTATÍSTICAS:' + colors.reset);
      console.log(`   Total de usuários: ${colors.cyan}${stats.totalUsers}${colors.reset}`);
      console.log(`   Elegíveis: ${colors.green}${stats.eligibleUsers}${colors.reset}`);
      console.log(`   Não elegíveis: ${colors.red}${stats.totalUsers - stats.eligibleUsers}${colors.reset}`);
      
      console.log('');
      console.log(colors.bright + '📋 BREAKDOWN:' + colors.reset);
      console.log(`   ✅ true explícito: ${analysis.breakdown.trueExplicit}`);
      console.log(`   ❌ false explícito: ${analysis.breakdown.falseExplicit}`);
      console.log(`   ⚪ undefined: ${analysis.breakdown.undefinedValue}`);
      console.log(`   ⚫ null: ${analysis.breakdown.nullValue}`);
      console.log(`   🚫 sem preferences: ${analysis.breakdown.noPreferencesObject}`);
      
      return { success: true, stats, analysis };
    } else {
      printError('Falha ao obter estatísticas');
      console.log('Response:', response.data);
      return { success: false };
    }
  } catch (error) {
    printError('Erro: ' + error.message);
    return { success: false };
  }
}

// Teste 3: Debug Detalhado de Usuários
async function testUserDebug() {
  printHeader('TESTE 3: Debug Detalhado de Usuários');
  
  try {
    const response = await makeRequest('/api/admin/email-users-debug');
    
    if (response.statusCode === 200 && response.data.success) {
      const summary = response.data.summary;
      const users = response.data.users;
      
      printSuccess('Debug obtido com sucesso!');
      console.log('');
      console.log(colors.bright + '👥 RESUMO:' + colors.reset);
      console.log(`   Total: ${summary.total}`);
      console.log(`   Elegíveis: ${colors.green}${summary.eligible}${colors.reset}`);
      console.log(`   Não elegíveis: ${colors.red}${summary.notEligible}${colors.reset}`);
      
      console.log('');
      console.log(colors.bright + '📝 PRIMEIROS 5 USUÁRIOS:' + colors.reset);
      users.slice(0, 5).forEach((user, index) => {
        const statusIcon = user.isEligible ? '✅' : '❌';
        const statusColor = user.isEligible ? colors.green : colors.red;
        console.log(`   ${index + 1}. ${statusIcon} ${user.name} (${user.email})`);
        console.log(`      ${statusColor}emailNotifications: ${user.emailNotifications}${colors.reset}`);
        console.log(`      Tipo: ${user.emailNotificationsType}`);
      });
      
      return { success: true, summary, users };
    } else {
      printError('Falha ao obter debug');
      return { success: false };
    }
  } catch (error) {
    printError('Erro: ' + error.message);
    return { success: false };
  }
}

// Teste 4: Validação de Lógica
async function testLogicValidation(statsResult, debugResult) {
  printHeader('TESTE 4: Validação de Lógica');
  
  if (!statsResult.success || !debugResult.success) {
    printWarning('Testes anteriores falharam, pulando validação');
    return false;
  }
  
  const stats = statsResult.stats;
  const debug = debugResult.summary;
  
  console.log(colors.bright + '🔍 VERIFICANDO CONSISTÊNCIA:' + colors.reset);
  console.log('');
  
  // Verificação 1: Total de usuários
  if (stats.totalUsers === debug.total) {
    printSuccess(`Total de usuários consistente: ${stats.totalUsers}`);
  } else {
    printError(`Total de usuários inconsistente! Stats: ${stats.totalUsers}, Debug: ${debug.total}`);
    return false;
  }
  
  // Verificação 2: Elegíveis
  if (stats.eligibleUsers === debug.eligible) {
    printSuccess(`Usuários elegíveis consistente: ${stats.eligibleUsers}`);
  } else {
    printError(`Usuários elegíveis inconsistente! Stats: ${stats.eligibleUsers}, Debug: ${debug.eligible}`);
    return false;
  }
  
  // Verificação 3: Soma do breakdown
  const breakdown = statsResult.analysis.breakdown;
  const totalBreakdown = breakdown.trueExplicit + breakdown.falseExplicit + 
                         breakdown.undefinedValue + breakdown.nullValue + 
                         breakdown.noPreferencesObject;
  
  if (totalBreakdown === stats.totalUsers) {
    printSuccess(`Breakdown correto: ${totalBreakdown} = ${stats.totalUsers}`);
  } else {
    printError(`Breakdown incorreto! Soma: ${totalBreakdown}, Total: ${stats.totalUsers}`);
    return false;
  }
  
  // Verificação 4: Apenas true = elegível
  if (breakdown.trueExplicit === stats.eligibleUsers) {
    printSuccess('Lógica correta: Apenas true explícito = elegível');
  } else {
    printWarning(`Lógica pode estar incorreta. True: ${breakdown.trueExplicit}, Elegíveis: ${stats.eligibleUsers}`);
  }
  
  return true;
}

// Teste 5: Resumo Final
function printFinalSummary(results) {
  printHeader('RESUMO FINAL DOS TESTES');
  
  const allPassed = results.every(r => r.passed);
  
  console.log(colors.bright + 'RESULTADOS:' + colors.reset);
  results.forEach(result => {
    if (result.passed) {
      printSuccess(result.name);
    } else {
      printError(result.name);
    }
  });
  
  console.log('');
  if (allPassed) {
    console.log(colors.green + colors.bright + '🎉 TODOS OS TESTES PASSARAM!' + colors.reset);
  } else {
    console.log(colors.red + colors.bright + '⚠️  ALGUNS TESTES FALHARAM' + colors.reset);
  }
  console.log('');
}

// Função principal
async function runAllTests() {
  console.log(colors.cyan + colors.bright);
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║     TESTE DO SISTEMA DE EMAIL - ZENITH GAMING           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(colors.reset);
  
  const results = [];
  
  // Teste 1: Conexão
  const connectionTest = await testConnection();
  results.push({ name: 'Conexão com API', passed: connectionTest });
  
  if (!connectionTest) {
    printError('Impossível continuar sem conexão com a API');
    printFinalSummary(results);
    return;
  }
  
  // Teste 2: Estatísticas
  const statsResult = await testEmailStats();
  results.push({ name: 'Estatísticas de Email', passed: statsResult.success });
  
  // Teste 3: Debug
  const debugResult = await testUserDebug();
  results.push({ name: 'Debug de Usuários', passed: debugResult.success });
  
  // Teste 4: Validação
  const validationResult = await testLogicValidation(statsResult, debugResult);
  results.push({ name: 'Validação de Lógica', passed: validationResult });
  
  // Resumo Final
  printFinalSummary(results);
}

// Executar testes
runAllTests().catch(error => {
  console.error(colors.red + 'Erro fatal:', error.message + colors.reset);
  process.exit(1);
});

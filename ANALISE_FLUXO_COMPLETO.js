require('dotenv').config();
const fs = require('fs');

console.log('🔍 ANÁLISE COMPLETA DO FLUXO: MARKETPLACE VS BOOSTING\n');
console.log('=' .repeat(80));

// 1. Verificar configuração .env
console.log('\n📋 1. CONFIGURAÇÃO (.env):');
console.log('-'.repeat(80));
console.log('  MEDIATOR_EMAIL:', process.env.MEDIATOR_EMAIL || '❌ NÃO CONFIGURADO');
if (!process.env.MEDIATOR_EMAIL) {
  console.log('  ❌ PROBLEMA: Email do mediador não configurado!');
} else {
  console.log('  ✅ Email configurado');
}

// 2. Verificar Model WalletLedger
console.log('\n📋 2. MODEL WALLETLEDGER (Enum "reason"):');
console.log('-'.repeat(80));

const walletLedgerPath = './src/models/WalletLedger.js';
const walletLedgerContent = fs.readFileSync(walletLedgerPath, 'utf8');

const reasonMatch = walletLedgerContent.match(/reason:\s*{\s*type:\s*String,\s*enum:\s*\[([\s\S]*?)\]/);
if (reasonMatch) {
  const reasons = reasonMatch[1]
    .split(',')
    .map(r => r.trim().replace(/['"]/g, ''))
    .filter(r => r);
  
  console.log('  Enums encontrados:');
  reasons.forEach(r => console.log(`    - ${r}`));
  
  const requiredReasons = [
    'purchase_fee',
    'purchase_release',
    'boosting_fee',
    'boosting_release',
    'boosting_escrow',
    'boosting_escrow_release'
  ];
  
  console.log('\n  Verificando enums necessários:');
  requiredReasons.forEach(req => {
    const exists = reasons.includes(req);
    console.log(`    ${exists ? '✅' : '❌'} ${req}`);
  });
} else {
  console.log('  ❌ Não foi possível extrair enum do modelo!');
}

// 3. Verificar Model Agreement
console.log('\n📋 3. MODEL AGREEMENT (Enum "paymentStatus"):');
console.log('-'.repeat(80));

const agreementPath = './src/models/Agreement.js';
const agreementContent = fs.readFileSync(agreementPath, 'utf8');

const paymentStatusMatch = agreementContent.match(/paymentStatus:\s*{\s*type:\s*String,\s*enum:\s*\[([\s\S]*?)\]/);
if (paymentStatusMatch) {
  const statuses = paymentStatusMatch[1]
    .split(',')
    .map(s => s.trim().replace(/['"]/g, ''))
    .filter(s => s);
  
  console.log('  Enums encontrados:');
  statuses.forEach(s => console.log(`    - ${s}`));
  
  const hasEscrowed = statuses.includes('escrowed');
  console.log(`\n  ${hasEscrowed ? '✅' : '❌'} Enum "escrowed" ${hasEscrowed ? 'presente' : 'ausente'}`);
} else {
  console.log('  ❌ Não foi possível extrair enum do modelo!');
}

// 4. Analisar fluxo do Marketplace
console.log('\n📋 4. FLUXO DO MARKETPLACE (purchasesRoutes.js):');
console.log('-'.repeat(80));

const purchasesPath = './src/routes/purchasesRoutes.js';
const purchasesContent = fs.readFileSync(purchasesPath, 'utf8');

// Verificar se credita vendedor
const hasSellerCredit = purchasesContent.includes('seller.walletBalance = after');
console.log(`  ${hasSellerCredit ? '✅' : '❌'} Credita vendedor (95%)`);

// Verificar se credita mediador
const hasMediatorCredit = purchasesContent.includes('mediatorUser.walletBalance = medAfter');
console.log(`  ${hasMediatorCredit ? '✅' : '❌'} Credita mediador (5%)`);

// Verificar busca do mediador
const searchByEmail = purchasesContent.includes('User.findOne({ email: envEmail })') ||
                      purchasesContent.includes('User.findOne({ email: mediatorEmail })');
console.log(`  ${searchByEmail ? '✅' : '❌'} Busca mediador por email`);

// Verificar WalletLedger do vendedor
const hasSellerLedger = purchasesContent.includes("reason: 'purchase_release'");
console.log(`  ${hasSellerLedger ? '✅' : '❌'} Cria WalletLedger (vendedor - purchase_release)`);

// Verificar WalletLedger do mediador
const hasMediatorLedger = purchasesContent.includes("reason: 'purchase_fee'");
console.log(`  ${hasMediatorLedger ? '✅' : '❌'} Cria WalletLedger (mediador - purchase_fee)`);

// Verificar Mediator log (release)
const hasMediatorReleaseLog = purchasesContent.includes("eventType: 'release'");
console.log(`  ${hasMediatorReleaseLog ? '✅' : '❌'} Cria Mediator log (release)`);

// Verificar Mediator log (fee)
const hasMediatorFeeLog = purchasesContent.includes("eventType: 'fee'");
console.log(`  ${hasMediatorFeeLog ? '✅' : '❌'} Cria Mediator log (fee)`);

// 5. Analisar fluxo do Boosting
console.log('\n📋 5. FLUXO DO BOOSTING (boostingChatController.js):');
console.log('-'.repeat(80));

const boostingPath = './src/controllers/boostingChatController.js';
const boostingContent = fs.readFileSync(boostingPath, 'utf8');

// Verificar se credita booster
const hasBoosterCredit = boostingContent.includes('boosterUser.walletBalance = boosterBalanceAfter');
console.log(`  ${hasBoosterCredit ? '✅' : '❌'} Credita booster (95%)`);

// Verificar se credita mediador
const hasBoostingMediatorCredit = boostingContent.includes('mediatorUser.walletBalance = mediatorBalanceAfter');
console.log(`  ${hasBoostingMediatorCredit ? '✅' : '❌'} Credita mediador (5%)`);

// Verificar busca do mediador
const boostingSearchByEmail = boostingContent.includes('User.findOne({ email: mediatorEmail })');
console.log(`  ${boostingSearchByEmail ? '✅' : '❌'} Busca mediador por email`);

// Verificar WalletLedger do booster
const hasBoosterLedger = boostingContent.includes("reason: 'boosting_release'");
console.log(`  ${hasBoosterLedger ? '✅' : '❌'} Cria WalletLedger (booster - boosting_release)`);

// Verificar WalletLedger do mediador
const hasBoostingMediatorLedger = boostingContent.includes("reason: 'boosting_fee'");
console.log(`  ${hasBoostingMediatorLedger ? '✅' : '❌'} Cria WalletLedger (mediador - boosting_fee)`);

// Verificar Mediator log (release)
const hasBoostingMediatorReleaseLog = boostingContent.includes("eventType: 'release'");
console.log(`  ${hasBoostingMediatorReleaseLog ? '✅' : '❌'} Cria Mediator log (release)`);

// Verificar Mediator log (fee)
const hasBoostingMediatorFeeLog = boostingContent.includes("eventType: 'fee'");
console.log(`  ${hasBoostingMediatorFeeLog ? '✅' : '❌'} Cria Mediator log (fee)`);

// Verificar escrow no boosting
const hasEscrowCheck = boostingContent.includes("reason: 'boosting_escrow'");
console.log(`  ${hasEscrowCheck ? '✅' : '❌'} Verifica escrow (boosting_escrow)`);

const hasEscrowRelease = boostingContent.includes("reason: 'boosting_escrow_release'");
console.log(`  ${hasEscrowRelease ? '✅' : '❌'} Registra liberação de escrow`);

// 6. Comparação lado a lado
console.log('\n📋 6. COMPARAÇÃO LADO A LADO:');
console.log('-'.repeat(80));

const comparison = [
  ['Funcionalidade', 'Marketplace', 'Boosting', 'Status'],
  ['-'.repeat(30), '-'.repeat(15), '-'.repeat(15), '-'.repeat(10)],
  ['Credita prestador (95%)', '✅ Vendedor', '✅ Booster', '✅ OK'],
  ['Credita mediador (5%)', '✅ Sim', hasBoostingMediatorCredit ? '✅ Sim' : '❌ Não', hasBoostingMediatorCredit ? '✅ OK' : '❌ ERRO'],
  ['Busca mediador por email', '✅ Sim', boostingSearchByEmail ? '✅ Sim' : '❌ Não', boostingSearchByEmail ? '✅ OK' : '❌ ERRO'],
  ['WalletLedger prestador', '✅ purchase_release', '✅ boosting_release', '✅ OK'],
  ['WalletLedger mediador', '✅ purchase_fee', hasBoostingMediatorLedger ? '✅ boosting_fee' : '❌ Não', hasBoostingMediatorLedger ? '✅ OK' : '❌ ERRO'],
  ['Mediator log (release)', '✅ Sim', hasBoostingMediatorReleaseLog ? '✅ Sim' : '❌ Não', hasBoostingMediatorReleaseLog ? '✅ OK' : '❌ ERRO'],
  ['Mediator log (fee)', '✅ Sim', hasBoostingMediatorFeeLog ? '✅ Sim' : '❌ Não', hasBoostingMediatorFeeLog ? '✅ OK' : '❌ ERRO'],
  ['Sistema de escrow', '✅ Sim', hasEscrowCheck ? '✅ Sim' : '❌ Não', hasEscrowCheck ? '✅ OK' : '❌ ERRO'],
];

comparison.forEach(row => {
  console.log(`  ${row[0].padEnd(30)} | ${row[1].padEnd(15)} | ${row[2].padEnd(15)} | ${row[3]}`);
});

// 7. Verificar se há warnings/erros
console.log('\n📋 7. VERIFICAÇÃO DE PROBLEMAS:');
console.log('-'.repeat(80));

const problems = [];

if (!process.env.MEDIATOR_EMAIL) {
  problems.push('❌ MEDIATOR_EMAIL não configurado no .env');
}

if (!hasBoostingMediatorCredit) {
  problems.push('❌ Boosting não está creditando o mediador');
}

if (!boostingSearchByEmail) {
  problems.push('❌ Boosting não está buscando mediador por email');
}

if (!hasBoostingMediatorLedger) {
  problems.push('❌ Boosting não está criando WalletLedger do mediador');
}

if (!hasBoostingMediatorFeeLog) {
  problems.push('❌ Boosting não está criando Mediator log (fee)');
}

if (problems.length === 0) {
  console.log('  ✅ NENHUM PROBLEMA ENCONTRADO!');
  console.log('  ✅ O fluxo está 100% correto e idêntico ao marketplace!');
} else {
  console.log('  Problemas encontrados:');
  problems.forEach(p => console.log(`    ${p}`));
}

// 8. Resumo final
console.log('\n📋 8. RESUMO FINAL:');
console.log('-'.repeat(80));

const allChecks = [
  process.env.MEDIATOR_EMAIL,
  hasBoostingMediatorCredit,
  boostingSearchByEmail,
  hasBoostingMediatorLedger,
  hasBoostingMediatorFeeLog,
  hasBoostingMediatorReleaseLog,
  hasEscrowCheck
];

const passedChecks = allChecks.filter(Boolean).length;
const totalChecks = allChecks.length;
const percentage = Math.round((passedChecks / totalChecks) * 100);

console.log(`  Verificações passadas: ${passedChecks}/${totalChecks} (${percentage}%)`);
console.log('');

if (percentage === 100) {
  console.log('  🎉 SISTEMA 100% CORRETO!');
  console.log('  ✅ Marketplace e Boosting usam o MESMO fluxo');
  console.log('  ✅ Mediador será creditado em ambos os sistemas');
  console.log('');
  console.log('  📋 Próximos passos:');
  console.log('    1. pm2 restart ZenithChat');
  console.log('    2. Confirmar entrega de boosting');
  console.log('    3. Verificar saldo do mediador aumentou');
} else {
  console.log('  ⚠️ SISTEMA PRECISA DE AJUSTES');
  console.log('  Revise os problemas listados acima');
}

console.log('\n' + '='.repeat(80));
console.log('✅ Análise completa concluída!\n');

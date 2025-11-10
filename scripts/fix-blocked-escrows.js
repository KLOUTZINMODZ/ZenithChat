/**
 * Script de Migração: Corrigir Escrows Bloqueados
 * 
 * Este script identifica e corrige escrows bloqueados de agreements cancelados
 * que não tiveram o saldo devolvido ao cliente.
 * 
 * USO:
 *   node scripts/fix-blocked-escrows.js
 * 
 * OU no MongoDB Atlas/Compass:
 *   Copiar e colar as funções relevantes no console MongoDB
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Agreement = require('../src/models/Agreement');
const WalletLedger = require('../src/models/WalletLedger');
const User = require('../src/models/User');

// Helper functions
function round2(v) { 
  return Math.round(Number(v) * 100) / 100; 
}

async function runTx(executor) {
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const res = await executor(session);
    await session.commitTransaction();
    session.endSession();
    return res;
  } catch (err) {
    if (session) { 
      try { await session.abortTransaction(); } catch (_) {} 
      session.endSession(); 
    }
    throw err;
  }
}

/**
 * Função principal: Corrigir escrows bloqueados
 */
async function fixBlockedEscrows(options = {}) {
  const {
    dryRun = false,  // Se true, apenas simula sem fazer alterações
    startDate = new Date('2024-01-01'),  // Data inicial para buscar agreements
    limit = 100  // Limite de agreements para processar por vez
  } = options;

  console.log('\n🔍 Iniciando correção de escrows bloqueados...');
  console.log(`📅 Data inicial: ${startDate.toISOString()}`);
  console.log(`🔄 Modo: ${dryRun ? 'DRY RUN (simulação)' : 'PRODUÇÃO (real)'}`);
  console.log(`📊 Limite: ${limit} agreements por execução\n`);

  try {
    // 1. Buscar agreements cancelados
    const cancelledAgreements = await Agreement.find({
      status: 'cancelled',
      createdAt: { $gte: startDate }
    })
    .sort({ createdAt: -1 })
    .limit(limit);

    console.log(`📋 Encontrados ${cancelledAgreements.length} agreements cancelados\n`);

    let fixed = 0;
    let alreadyFixed = 0;
    let noEscrow = 0;
    let errors = 0;

    for (const agreement of cancelledAgreements) {
      const agreementId = agreement._id.toString();
      const clientId = agreement.parties?.client?.userid;

      if (!clientId) {
        console.log(`⚠️  Agreement ${agreementId}: sem clientId`);
        errors++;
        continue;
      }

      try {
        // 2. Verificar se tem escrow não devolvido
        const escrow = await WalletLedger.findOne({
          userId: clientId,
          reason: 'boosting_escrow',
          'metadata.agreementId': agreementId
        });

        if (!escrow) {
          console.log(`ℹ️  Agreement ${agreementId}: sem escrow (pode ser fluxo legado)`);
          noEscrow++;
          continue;
        }

        // 3. Verificar se já foi devolvido
        const refund = await WalletLedger.findOne({
          userId: clientId,
          reason: 'boosting_escrow_refund',
          'metadata.agreementId': agreementId
        });

        if (refund) {
          console.log(`✅ Agreement ${agreementId}: escrow JÁ devolvido em ${refund.createdAt.toISOString()}`);
          alreadyFixed++;
          continue;
        }

        // 4. DEVOLVER ESCROW
        console.log(`\n🔧 Agreement ${agreementId}:`);
        console.log(`   Cliente: ${clientId}`);
        console.log(`   Valor bloqueado: R$ ${escrow.amount.toFixed(2)}`);
        console.log(`   Data do escrow: ${escrow.createdAt.toISOString()}`);
        console.log(`   Data do cancelamento: ${agreement.cancelledAt?.toISOString() || 'N/A'}`);

        if (dryRun) {
          console.log(`   [DRY RUN] Seria devolvido R$ ${escrow.amount.toFixed(2)} ao cliente`);
          fixed++;
          continue;
        }

        // Executar devolução em transação
        await runTx(async (session) => {
          const clientUser = await User.findById(clientId).session(session);
          
          if (!clientUser) {
            throw new Error(`Cliente ${clientId} não encontrado`);
          }

          const balanceBefore = round2(clientUser.walletBalance || 0);
          const balanceAfter = round2(balanceBefore + escrow.amount);
          
          console.log(`   Saldo antes: R$ ${balanceBefore.toFixed(2)}`);
          console.log(`   Saldo depois: R$ ${balanceAfter.toFixed(2)}`);

          clientUser.walletBalance = balanceAfter;
          await clientUser.save({ session });

          await WalletLedger.create([{
            userId: clientId,
            txId: null,
            direction: 'credit',
            reason: 'boosting_escrow_refund',
            amount: escrow.amount,
            operationId: `boosting_escrow_refund:${agreementId}`,
            balanceBefore: balanceBefore,
            balanceAfter: balanceAfter,
            metadata: {
              source: 'boosting',
              agreementId: agreementId,
              conversationId: agreement.conversationId?.toString() || null,
              cancelledBy: 'system',
              cancelReason: 'Correção de escrow bloqueado via script de migração',
              originalEscrowId: escrow._id.toString(),
              type: 'escrow_refund',
              migration: true,
              migratedAt: new Date()
            }
          }], { session });

          console.log(`   ✅ Escrow devolvido com sucesso!`);
        });

        fixed++;

      } catch (err) {
        console.error(`   ❌ Erro ao corrigir agreement ${agreementId}:`, err.message);
        errors++;
      }
    }

    // Resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DA EXECUÇÃO');
    console.log('='.repeat(60));
    console.log(`✅ Corrigidos: ${fixed}`);
    console.log(`✔️  Já corrigidos: ${alreadyFixed}`);
    console.log(`ℹ️  Sem escrow: ${noEscrow}`);
    console.log(`❌ Erros: ${errors}`);
    console.log(`📋 Total processado: ${cancelledAgreements.length}`);
    console.log('='.repeat(60) + '\n');

    if (dryRun) {
      console.log('⚠️  Este foi um DRY RUN. Nenhuma alteração foi feita.');
      console.log('   Execute novamente com { dryRun: false } para aplicar as correções.\n');
    } else {
      console.log('✅ Migração concluída com sucesso!\n');
    }

    return {
      fixed,
      alreadyFixed,
      noEscrow,
      errors,
      total: cancelledAgreements.length
    };

  } catch (error) {
    console.error('\n❌ Erro fatal na migração:', error);
    throw error;
  }
}

/**
 * Função auxiliar: Verificar escrows bloqueados (sem corrigir)
 */
async function auditBlockedEscrows(startDate = new Date('2024-01-01')) {
  console.log('\n🔍 Auditoria de Escrows Bloqueados\n');

  const cancelledAgreements = await Agreement.find({
    status: 'cancelled',
    createdAt: { $gte: startDate }
  });

  let totalBlocked = 0;
  let totalAmount = 0;

  for (const agreement of cancelledAgreements) {
    const clientId = agreement.parties?.client?.userid;
    if (!clientId) continue;

    const escrow = await WalletLedger.findOne({
      userId: clientId,
      reason: 'boosting_escrow',
      'metadata.agreementId': agreement._id.toString()
    });

    if (!escrow) continue;

    const refund = await WalletLedger.findOne({
      userId: clientId,
      reason: 'boosting_escrow_refund',
      'metadata.agreementId': agreement._id.toString()
    });

    if (!refund) {
      totalBlocked++;
      totalAmount += escrow.amount;
      console.log(`❌ Agreement ${agreement._id}: R$ ${escrow.amount.toFixed(2)} bloqueado`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Total de escrows bloqueados: ${totalBlocked}`);
  console.log(`💰 Valor total bloqueado: R$ ${totalAmount.toFixed(2)}`);
  console.log('='.repeat(60) + '\n');

  return { totalBlocked, totalAmount };
}

// Exportar funções para uso em outros scripts
module.exports = {
  fixBlockedEscrows,
  auditBlockedEscrows
};

// Se executado diretamente
if (require.main === module) {
  (async () => {
    try {
      // Conectar ao MongoDB
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hacklote-chat');
      console.log('✅ Conectado ao MongoDB\n');

      // 1. Fazer auditoria primeiro (ver quantos estão bloqueados)
      await auditBlockedEscrows();

      // 2. Fazer dry run (simular correção)
      console.log('\n🔄 Executando DRY RUN...\n');
      await fixBlockedEscrows({ dryRun: true });

      // 3. Perguntar se deseja prosseguir (em ambiente interativo)
      // Em produção, remover o readline e executar diretamente
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      readline.question('\n⚠️  Deseja aplicar as correções? (sim/não): ', async (answer) => {
        if (answer.toLowerCase() === 'sim') {
          console.log('\n🚀 Executando correção REAL...\n');
          await fixBlockedEscrows({ dryRun: false });
        } else {
          console.log('\n❌ Correção cancelada pelo usuário.\n');
        }
        
        readline.close();
        await mongoose.connection.close();
        console.log('✅ Desconectado do MongoDB\n');
        process.exit(0);
      });

    } catch (error) {
      console.error('❌ Erro fatal:', error);
      await mongoose.connection.close();
      process.exit(1);
    }
  })();
}

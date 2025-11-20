/*
 * Script para análise de conversas no MongoDB
 *
 * Uso sugerido (reutilizando o mesmo .env da API):
 *   node scripts/analyzeConversations.js
 *
 * Ele usa as mesmas variáveis do .env que o servidor usa
 * (principalmente MONGODB_URI e MONGODB_DBNAME), via src/config/database.js.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

// Garante que o script rode a partir da raiz do HackloteChatApi
const projectRoot = path.resolve(__dirname, '..');

// Reutiliza o mesmo config de conexão do servidor (usa MONGODB_URI do .env)
const connectDB = require(path.join(projectRoot, 'src', 'config', 'database'));

// Reutiliza o mesmo model usado pela API de chat
// (o require relativo é baseado em projectRoot)
const Conversation = require(path.join(projectRoot, 'src', 'models', 'Conversation'));

function safeToString(v) {
  if (!v) return null;
  try {
    if (typeof v === 'string') return v;
    if (v.toString) return v.toString();
    return String(v);
  } catch (_) {
    return null;
  }
}

function extractMeta(conv) {
  const rawMeta = conv.metadata;
  let meta = {};
  if (!rawMeta) return meta;

  if (rawMeta instanceof Map || (typeof rawMeta.get === 'function' && typeof rawMeta.keys === 'function')) {
    meta = Object.fromEntries(rawMeta);
  } else if (typeof rawMeta === 'object') {
    meta = { ...rawMeta };
  }
  return meta;
}

async function analyze() {
  console.log('\n🕵️  Carregando conversas para análise...');

  const conversations = await Conversation.find({})
    .select('_id participants isTemporary status proposalId boostingStatus metadata lastMessageAt updatedAt')
    .lean();

  console.log(`Total de conversas encontradas: ${conversations.length}`);

  const byProposal = new Map();
  const byBoostingMeta = new Map();
  const temporaryConvs = [];

  for (const conv of conversations) {
    const meta = extractMeta(conv);

    const proposalId = safeToString(conv.proposalId || meta.proposalId || meta.propostaId);
    const boostingId = safeToString(meta.boostingId || meta.relatedBoostingId || meta.boostingRequestId);

    const keyProposal = proposalId || null;
    const keyBoosting = boostingId || null;

    if (keyProposal) {
      if (!byProposal.has(keyProposal)) byProposal.set(keyProposal, []);
      byProposal.get(keyProposal).push({ conv, meta });
    }

    if (keyBoosting) {
      if (!byBoostingMeta.has(keyBoosting)) byBoostingMeta.set(keyBoosting, []);
      byBoostingMeta.get(keyBoosting).push({ conv, meta });
    }

    if (conv.isTemporary || conv.status === 'temporary') {
      temporaryConvs.push({ conv, meta });
    }
  }

  console.log('\n📊 Conversas temporárias (isTemporary=true ou status="temporary")');
  console.log('----------------------------------------------------------------');
  if (temporaryConvs.length === 0) {
    console.log('Nenhuma conversa temporária encontrada.');
  } else {
    temporaryConvs.slice(0, 50).forEach(({ conv, meta }) => {
      console.log(`- _id=${conv._id} | status=${conv.status} | isTemporary=${!!conv.isTemporary}`);
      console.log(`  proposalId=${safeToString(conv.proposalId || meta.proposalId)} | boostingId=${safeToString(meta.boostingId || meta.relatedBoostingId)}`);
      console.log(`  lastMessageAt=${conv.lastMessageAt} | updatedAt=${conv.updatedAt}`);
    });
    if (temporaryConvs.length > 50) {
      console.log(`  ... e mais ${temporaryConvs.length - 50} temporárias (limitado a 50 para log).`);
    }
  }

  console.log('\n📊 Possíveis duplicadas por proposalId (grupos com mais de 1 conversa)');
  console.log('----------------------------------------------------------------------');
  let dupCountProposal = 0;
  for (const [proposalId, list] of byProposal.entries()) {
    if (list.length <= 1) continue;
    dupCountProposal++;
    console.log(`\n➡ proposalId=${proposalId} -> ${list.length} conversas:`);
    list.forEach(({ conv, meta }) => {
      console.log(`  - _id=${conv._id} | isTemporary=${!!conv.isTemporary} | status=${conv.status} | boostingStatus=${conv.boostingStatus}`);
      console.log(`    boostingId=${safeToString(meta.boostingId || meta.relatedBoostingId)} | lastMessageAt=${conv.lastMessageAt}`);
    });
  }
  if (dupCountProposal === 0) {
    console.log('Nenhum grupo com mais de uma conversa por proposalId.');
  }

  console.log('\n📊 Possíveis duplicadas por boostingId em metadata (grupos com mais de 1 conversa)');
  console.log('--------------------------------------------------------------------------------');
  let dupCountBoosting = 0;
  for (const [boostingId, list] of byBoostingMeta.entries()) {
    if (list.length <= 1) continue;
    dupCountBoosting++;
    console.log(`\n➡ boostingId=${boostingId} -> ${list.length} conversas:`);
    list.forEach(({ conv, meta }) => {
      console.log(`  - _id=${conv._id} | isTemporary=${!!conv.isTemporary} | status=${conv.status} | proposalId=${safeToString(conv.proposalId || meta.proposalId)}`);
      console.log(`    lastMessageAt=${conv.lastMessageAt} | updatedAt=${conv.updatedAt}`);
    });
  }
  if (dupCountBoosting === 0) {
    console.log('Nenhum grupo com mais de uma conversa por boostingId.');
  }

  console.log('\n✅ Análise concluída.');
}

(async () => {
  try {
    await connectDB();
    await analyze();
  } catch (err) {
    console.error('Erro ao executar análise:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();

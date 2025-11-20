/*
 * Script para limpar conversas duplicadas na Chat API
 *
 * Estratégia:
 * - Agrupa conversas por proposalId e boostingId (em metadata)
 * - Para cada grupo com mais de 1 conversa:
 *   - Escolhe uma conversa "canônica" (com lastMessageAt definido; se empatar, a mais recente por updatedAt)
 *   - Marca as outras como arquivadas/inativas (isActive=false, isDeleted=true, status='archived')
 *   - Mantém logs detalhados do que foi feito
 *
 * Uso:
 *   node scripts/cleanupDuplicateConversations.js --dry-run   (só mostra o que faria)
 *   node scripts/cleanupDuplicateConversations.js             (aplica as alterações)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const connectDB = require(path.join(projectRoot, 'src', 'config', 'database'));
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

async function loadConversations() {
  const conversations = await Conversation.find({})
    .select('_id participants isTemporary status isActive isDeleted proposalId boostingStatus metadata lastMessageAt updatedAt')
    .lean();

  console.log(`Total de conversas carregadas: ${conversations.length}`);
  return conversations;
}

function groupDuplicates(conversations) {
  const byProposal = new Map();
  const byBoosting = new Map();

  for (const conv of conversations) {
    const meta = extractMeta(conv);

    const proposalId = safeToString(conv.proposalId || meta.proposalId || meta.propostaId);
    const boostingId = safeToString(meta.boostingId || meta.relatedBoostingId || meta.boostingRequestId);

    if (proposalId) {
      if (!byProposal.has(proposalId)) byProposal.set(proposalId, []);
      byProposal.get(proposalId).push({ conv, meta });
    }

    if (boostingId) {
      if (!byBoosting.has(boostingId)) byBoosting.set(boostingId, []);
      byBoosting.get(boostingId).push({ conv, meta });
    }
  }

  const duplicateGroups = [];

  // Agrupa por proposalId
  for (const [proposalId, list] of byProposal.entries()) {
    if (list.length <= 1) continue;
    duplicateGroups.push({ keyType: 'proposalId', key: proposalId, list });
  }

  // Agrupa por boostingId, mas evita repetir grupos já considerados por proposalId+set de ids igual
  for (const [boostingId, list] of byBoosting.entries()) {
    if (list.length <= 1) continue;
    const ids = list.map(({ conv }) => conv._id.toString()).sort().join(',');
    const already = duplicateGroups.some(g => g.keyType === 'boostingId' && g.key === boostingId && g._idsKey === ids);
    if (!already) {
      duplicateGroups.push({ keyType: 'boostingId', key: boostingId, list });
    }
  }

  // Anexa chave interna com ids para evitar duplicidade
  duplicateGroups.forEach(g => {
    g._idsKey = g.list.map(({ conv }) => conv._id.toString()).sort().join(',');
  });

  // Remover grupos duplicados com mesma combinação de ids
  const unique = [];
  const seenKeys = new Set();
  for (const g of duplicateGroups) {
    if (seenKeys.has(g._idsKey)) continue;
    seenKeys.add(g._idsKey);
    unique.push(g);
  }

  return unique;
}

function selectCanonicalAndDuplicates(group) {
  const items = group.list;

  // Critério 1: ter lastMessageAt definido (a conversa "ativa" com mensagens)
  const withLastMessage = items.filter(({ conv }) => !!conv.lastMessageAt);
  let canonical;

  if (withLastMessage.length > 0) {
    // Entre as que têm lastMessageAt, pega a mais recente por lastMessageAt
    canonical = withLastMessage.reduce((best, cur) => {
      if (!best) return cur;
      const b = new Date(best.conv.lastMessageAt || 0).getTime();
      const c = new Date(cur.conv.lastMessageAt || 0).getTime();
      return c > b ? cur : best;
    }, null);
  } else {
    // Se nenhuma tem lastMessageAt, usa updatedAt como fallback
    canonical = items.reduce((best, cur) => {
      if (!best) return cur;
      const b = new Date(best.conv.updatedAt || 0).getTime();
      const c = new Date(cur.conv.updatedAt || 0).getTime();
      return c > b ? cur : best;
    }, null);
  }

  const canonicalId = canonical.conv._id.toString();
  const duplicates = items.filter(({ conv }) => conv._id.toString() !== canonicalId);

  return { canonical, duplicates };
}

async function applyCleanup(groups, { dryRun }) {
  let totalDuplicates = 0;
  let totalArchived = 0;

  for (const group of groups) {
    const { canonical, duplicates } = selectCanonicalAndDuplicates(group);

    if (duplicates.length === 0) continue;

    totalDuplicates += duplicates.length;

    console.log(`\n==============================`);
    console.log(`Grupo duplicado por ${group.keyType}=${group.key}`);
    console.log(`Canônica: _id=${canonical.conv._id} | status=${canonical.conv.status} | isTemporary=${!!canonical.conv.isTemporary} | lastMessageAt=${canonical.conv.lastMessageAt}`);
    console.log(`Duplicatas (${duplicates.length}):`);
    duplicates.forEach(({ conv }) => {
      console.log(`  - _id=${conv._id} | status=${conv.status} | isTemporary=${!!conv.isTemporary} | isActive=${conv.isActive} | isDeleted=${conv.isDeleted} | lastMessageAt=${conv.lastMessageAt}`);
    });

    if (dryRun) {
      console.log('🧪 DRY-RUN: nenhuma alteração aplicada neste grupo.');
      continue;
    }

    // Arquivar duplicatas
    for (const { conv } of duplicates) {
      const doc = await Conversation.findById(conv._id);
      if (!doc) continue;

      doc.isActive = false;
      doc.isDeleted = true;
      // Não mexer no status se quiser manter histórico, mas podemos arquivar:
      if (!doc.status || doc.status === 'accepted' || doc.status === 'pending') {
        doc.status = 'archived';
      }

      // Marcar motivo no metadata
      if (!doc.metadata) {
        doc.metadata = new Map();
      }
      if (doc.metadata instanceof Map) {
        doc.metadata.set('archivedAt', new Date());
        doc.metadata.set('archivedReason', 'duplicate_conversation_cleanup');
        doc.metadata.set('primaryConversationId', canonical.conv._id.toString());
      } else {
        doc.metadata = {
          ...doc.metadata,
          archivedAt: new Date(),
          archivedReason: 'duplicate_conversation_cleanup',
          primaryConversationId: canonical.conv._id.toString()
        };
      }

      await doc.save();
      totalArchived++;
      console.log(`  ✅ Arquivada duplicata _id=${doc._id}`);
    }
  }

  console.log('\nResumo da limpeza:');
  console.log(`- Grupos com duplicatas: ${groups.length}`);
  console.log(`- Conversas duplicadas (não-canônicas) encontradas: ${totalDuplicates}`);
  console.log(`- Conversas arquivadas nesta execução: ${totalArchived}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('🚀 Iniciando limpeza de conversas duplicadas...');
  console.log(`Modo: ${dryRun ? 'DRY-RUN (somente leitura)' : 'APLICANDO ALTERAÇÕES'}`);

  try {
    await connectDB();
    const conversations = await loadConversations();
    const groups = groupDuplicates(conversations);

    if (!groups.length) {
      console.log('\nNenhum grupo de conversas duplicadas encontrado.');
      return;
    }

    console.log(`\nEncontrados ${groups.length} grupos potenciais de duplicatas.`);
    await applyCleanup(groups, { dryRun });
  } catch (err) {
    console.error('❌ Erro ao executar limpeza:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('❌ Erro inesperado:', err);
  process.exit(1);
});

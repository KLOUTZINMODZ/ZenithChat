const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const SupportMetric = require('../models/SupportMetric');
const { checkProhibitedContent } = require('../utils/contentFilter');

// Load KB (Portuguese)
let KB = [];
try {
  KB = require('../kb/help_pt.json');
} catch (e) {
  KB = [];
}

function normalizeText(t = '') {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}\s#]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEntities(text = '') {
  const norm = normalizeText(text);
  const mongoId = /\b([a-f0-9]{24})\b/.exec(norm)?.[1] || undefined;
  const orderNumber = /(?:pedido|venda|order|#)\s*#?(\d{3,})/.exec(norm)?.[1] || undefined;
  const amountMatch = /(?:r\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:,[0-9]{2})?)/.exec(norm);
  const amount = amountMatch ? Number(amountMatch[1].replace(/\./g, '').replace(',', '.')) : undefined;
  let pixKeyType, pixKey;
  const digits = norm.replace(/\D/g, '');
  if (digits.length === 11) { pixKeyType = 'cpf'; pixKey = digits; }
  if (digits.length === 14) { pixKeyType = 'cnpj'; pixKey = digits; }
  return { purchaseId: mongoId, orderNumber, amount, pixKeyType, pixKey };
}

function intentFrom(text = '') {
  const t = normalizeText(text);
  if (/(sou\s+)?comprador|\bbuyer\b/.test(t)) return 'role_buyer';
  if (/(sou\s+)?vendedor|\bseller\b/.test(t)) return 'role_seller';
  if (/(meus\s+tickets|abrir\s+tickets|^tickets$)/.test(t)) return 'tickets';
  if (/(acompanhar|status|ver).*(pedido|venda|order|#\d+)/.test(t)) return 'track_order';
  if (/(nao\s*recebi|nao\s*recebido|nao\s*chegou|pedido\s*nao\s*recebido)/.test(t)) return 'not_received';
  if (/(pagamento|paguei|recusado|falha|cartao|pix|boleto)/.test(t)) return 'payment_issues';
  if (/(reembolso|refund|devolucao)/.test(t)) return 'refund';
  if (/(disputa|contestacao|chargeback)/.test(t)) return 'dispute';
  if (/(cancelar|cancelei|quero\s+cancelar).*(pedido|compra|venda)?/.test(t)) return 'cancel_order';
  if (/(saldo|carteira|quanto\s+tenho|balance)/.test(t)) return 'wallet_balance';
  if (/(sacar|saque|retirar|withdraw)/.test(t)) return 'withdraw';
  if (/(vincular|cadastrar).*(chave\s+)?pix|\bbind\s+pix\b/.test(t)) return 'bind_pix';
  if (/(minha|qual).*(chave\s+)?pix/.test(t)) return 'pix_key';
  if (/(enviar|postar|marcar).*(pedido|venda).*envio|\bship\b/.test(t)) return 'ship_order';
  if (/(confirmar|confirmei).*(recebimento|entrega)|\bconfirm\s+delivery\b/.test(t)) return 'confirm_delivery';
  if (/(ir|abrir|acessar).*(carteira|wallet)/.test(t)) return 'navigate_wallet';
  if (/(ir|abrir|acessar).*(pedidos\s*em\s*aberto|open\s*orders)/.test(t)) return 'navigate_open_orders';
  if (/(ir|abrir|acessar).*(compras|purchases)/.test(t)) return 'navigate_purchases';
  if (/(ir|abrir|acessar).*(vendas|sales)/.test(t)) return 'navigate_sales';
  if (/(ir|abrir|acessar).*(mensagens|conversas|messages|chat)/.test(t)) return 'navigate_messages';
  if (/(ir|abrir|acessar).*(marketplace|loja)/.test(t)) return 'navigate_marketplace';
  if (/(ir|abrir|acessar).*(inicio|início|home|pagina\s*inicial|página\s*inicial)/.test(t)) return 'navigate_home';
  if (/(ajuda|duvidas|suporte\s+geral|help)/.test(t)) return 'help';
  return 'unknown';
}

function retrieveFromKB(query = '', limit = 3, tags = []) {
  const q = normalizeText(query);
  const scored = KB.map(item => {
    const text = normalizeText(`${item.title} ${item.content || ''} ${(item.tags || []).join(' ')}`);
    let score = 0;
    q.split(' ').forEach(tok => { if (tok && text.includes(tok)) score += 1; });
    (tags || []).forEach(tag => { if (text.includes(normalizeText(tag))) score += 0.5; });
    return { item, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score).slice(0, limit);
  return scored.map(s => ({ title: s.item.title, url: s.item.url, snippet: s.item.snippet || s.item.content?.slice(0, 280) || '' }));
}

router.post('/analyze', auth, async (req, res) => {
  try {
    const { text = '', context = {}, locale = 'pt-BR' } = req.body || {};
    const violations = checkProhibitedContent(text);
    const entities = extractEntities(text);
    const intent = intentFrom(text);
    const confidence = intent === 'unknown' ? 0.4 : 0.8;

    const tags = [];
    if (intent === 'withdraw' || intent === 'wallet_balance' || intent === 'bind_pix') tags.push('wallet');
    if (intent === 'not_received' || intent === 'dispute' || intent === 'refund') tags.push('orders');

    const citations = retrieveFromKB(text, 3, tags);
    let answer = '';
    if (citations.length > 0) {
      answer = `Encontrei algumas informações úteis para você. Confira as orientações e, se necessário, posso executar a ação sugerida.`;
    }

    // Suggested actions (basic planner)
    const suggestedActions = [];
    if (intent === 'not_received' && entities.purchaseId) {
      suggestedActions.push({ type: 'openTicket', label: 'Abrir Ticket (Pedido não recebido)', payload: { issueType: 'service_not_delivered', purchaseId: entities.purchaseId } });
    }
    if (intent === 'withdraw' && (entities.amount || context?.walletBalance > 0)) {
      suggestedActions.push({ type: 'withdraw', label: 'Sacar', payload: { amount: entities.amount || Math.floor(context.walletBalance) } });
    }
    if (intent.startsWith('navigate_')) {
      const path = {
        navigate_wallet: '/wallet',
        navigate_open_orders: '/open-orders',
        navigate_purchases: '/purchases',
        navigate_sales: '/sales',
        navigate_messages: '/messages',
        navigate_marketplace: '/marketplace',
        navigate_home: '/',
      }[intent] || '/';
      suggestedActions.push({ type: 'navigate', label: 'Abrir página relacionada', payload: { path } });
    }

    try {
      await SupportMetric.create({
        userId: req.user?._id || null,
        type: 'analyze',
        intent,
        confidence,
        entities,
        actions: suggestedActions.map(a => a.type),
        text,
        locale,
        meta: { violations: violations?.violations || [], contextSummary: { role: context?.role, walletBalance: context?.walletBalance } }
      });
    } catch (_) {}

    return res.json({ success: true, intent, confidence, entities, answer, citations, suggestedActions, violations: violations?.violations || [] });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Falha na análise', error: error.message });
  }
});

router.post('/suggest', auth, async (req, res) => {
  try {
    const { context = {} } = req.body || {};
    const role = String(context?.role || '').toLowerCase();
    const topics = [];
    const pick = (tag, n = 5) => KB.filter(x => (x.tags || []).includes(tag)).slice(0, n).map(x => x.title);
    if (role === 'buyer') {
      topics.push(...pick('buyer', 5));
    } else if (role === 'seller') {
      topics.push(...pick('seller', 5));
    }
    topics.push(...pick('common', 5));

    try { await SupportMetric.create({ userId: req.user?._id || null, type: 'suggest', text: '', locale: 'pt-BR', meta: { role } }); } catch (_) {}

    return res.json({ success: true, topics: Array.from(new Set(topics)).slice(0, 8) });
  } catch (error) {
    return res.status(500).json({ success: false, topics: [], message: 'Falha ao sugerir tópicos', error: error.message });
  }
});

module.exports = router;

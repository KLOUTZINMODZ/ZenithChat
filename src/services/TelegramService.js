const axios = require('axios');

// Utilidade: normaliza um número de telefone BR para o formato esperado pelo wa.me (somente dígitos, com DDI 55)
function normalizeBrazilPhone(raw) {
  try {
    if (!raw) return null;
    let d = String(raw).replace(/\D/g, '');
    if (!d) return null;
    // Se já começa com 55 e tem entre 12 e 13 dígitos (ex.: 55 + DDD + 9 + número)
    if (d.startsWith('55') && d.length >= 12 && d.length <= 13) return d;
    // Se já começa com 55 mas tem mais que 13 dígitos, tenta reduzir ao sufixo a partir do primeiro 55
    if (d.length > 13 && d.includes('55')) {
      const idx = d.indexOf('55');
      d = d.slice(idx);
      if (d.length >= 12 && d.length <= 13) return d;
    }
    // Se não tem 55, adiciona. Aceita 10 ou 11 dígitos (DDD + número)
    if (d.length === 10 || d.length === 11) return '55' + d;
    // Último recurso: prefixa 55
    return '55' + d;
  } catch (_) { return null; }
}

// Monta o texto da mensagem do ticket com HTML (parse_mode: 'HTML')
function buildTicketMessage({ client = {}, reporter = {}, reported = {}, report = {}, context = {} }) {
  const lines = [];
  lines.push('🚨 <b>Novo Ticket de Suporte</b>');
  if (report?.type) lines.push(`🧾 <b>Tipo:</b> ${escapeHtml(String(report.type))}`);
  if (report?.id) lines.push(`🎫 <b>Ticket ID:</b> <code>${escapeHtml(String(report.id))}</code>`);
  if (context?.conversationId) lines.push(`💬 <b>Conversa:</b> <code>${escapeHtml(String(context.conversationId))}</code>`);
  if (context?.purchaseId) lines.push(`🛒 <b>Compra:</b> <code>${escapeHtml(String(context.purchaseId))}</code>`);
  lines.push('');

  // Cliente (prioritário para contato)
  lines.push('<b>👤 Cliente</b>');
  if (client?.name) lines.push(`• <b>Nome:</b> ${escapeHtml(String(client.name))}`);
  if (client?.username) lines.push(`• <b>Usuário:</b> @${escapeHtml(String(client.username))}`);
  if (client?.email) lines.push(`• <b>Email:</b> ${escapeHtml(String(client.email))}`);
  if (client?.id) lines.push(`• <b>ID:</b> <code>${escapeHtml(String(client.id))}</code>`);
  if (client?.phoneNormalized) lines.push(`• <b>WhatsApp:</b> +${escapeHtml(String(client.phoneNormalized))}`);

  // Reporter (opcional)
  if (reporter && (reporter.name || reporter.id)) {
    lines.push('', '<b>🗣️ Aberto por</b>');
    if (reporter.name) lines.push(`• <b>Nome:</b> ${escapeHtml(String(reporter.name))}`);
    if (reporter.username) lines.push(`• <b>Usuário:</b> @${escapeHtml(String(reporter.username))}`);
    if (reporter.email) lines.push(`• <b>Email:</b> ${escapeHtml(String(reporter.email))}`);
    if (reporter.id) lines.push(`• <b>ID:</b> <code>${escapeHtml(String(reporter.id))}</code>`);
    if (reporter.phoneNormalized) lines.push(`• <b>WhatsApp:</b> +${escapeHtml(String(reporter.phoneNormalized))}`);
  }

  // Reported (opcional)
  if (reported && (reported.name || reported.id)) {
    lines.push('', '<b>👥 Denunciado</b>');
    if (reported.name) lines.push(`• <b>Nome:</b> ${escapeHtml(String(reported.name))}`);
    if (reported.username) lines.push(`• <b>Usuário:</b> @${escapeHtml(String(reported.username))}`);
    if (reported.email) lines.push(`• <b>Email:</b> ${escapeHtml(String(reported.email))}`);
    if (reported.id) lines.push(`• <b>ID:</b> <code>${escapeHtml(String(reported.id))}</code>`);
  }

  // Razão/descrição
  if (report?.reason || report?.description) {
    lines.push('', '<b>📝 Detalhes</b>');
    if (report.reason) lines.push(`• <b>Motivo:</b> ${escapeHtml(String(report.reason))}`);
    if (report.description) lines.push(`• <b>Descrição:</b> ${escapeHtml(String(report.description))}`);
  }

  return lines.join('\n');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendMessageToTelegram({ text, buttonUrl = null, buttonText = 'Entrar em Contato' }) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID || '-4883243635';

    if (!token || !chatId) {
      // Não logar token por segurança
      console.warn('[TelegramService] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID. Skipping notification.');
      return { skipped: true };
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    if (buttonUrl) {
      payload.reply_markup = {
        inline_keyboard: [
          [ { text: buttonText, url: String(buttonUrl) } ]
        ]
      };
    }

    await axios.post(url, payload, { timeout: 10000 });
    return { success: true };
  } catch (err) {
    try {
      console.error('[TelegramService] Failed to send message to Telegram:', err?.response?.data || err?.message || err);
    } catch (_) {}
    return { success: false, error: err?.message };
  }
}

async function sendSupportTicketNotification({ client = {}, reporter = {}, reported = {}, report = {}, context = {} }) {
  try {
    // Normaliza telefones (se presentes)
    const normalizedClient = normalizeBrazilPhone(
      client.phone || client.phoneNumber || client.whatsapp || client.whatsApp || client.mobile || client.phoneNormalized || null
    );
    const normalizedReporter = normalizeBrazilPhone(
      reporter.phone || reporter.phoneNumber || reporter.whatsapp || reporter.whatsApp || reporter.mobile || reporter.phoneNormalized || null
    );
    const message = buildTicketMessage({
      client: {
        ...client,
        phoneNormalized: normalizedClient || null
      },
      reporter: {
        ...reporter,
        phoneNormalized: normalizedReporter || null
      },
      reported,
      report,
      context
    });

    // Preferimos o WhatsApp do solicitante (reporter); fallback para o cliente
    const prefer = normalizedReporter || normalizedClient || null;
    const waLink = prefer ? `https://wa.me/${prefer}` : null;

    return await sendMessageToTelegram({ text: message, buttonUrl: waLink, buttonText: 'Prestar Suporte' });
  } catch (e) {
    try { console.error('[TelegramService] Error building/sending support ticket notification:', e?.message || e); } catch (_) {}
    return { success: false, error: e?.message };
  }
}

module.exports = {
  normalizeBrazilPhone,
  sendSupportTicketNotification
};

const removeDiacritics = (str = '') => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const basePT = [
  'porra','merda','caralho','buceta','puta','puto','fdp','pqp','babaca','otario','otária','otaria','otário','desgraçado','desgracado','arrombado','arrombada','vagabundo','vagabunda','cuzão','cuzao','cu','pau no cu','pau-no-cu','pau','pênis','penis','bosta','corno','safado','safada','escroto','escrota','viado','viada','viadinho','boiola','bicha','retardado','retardada'
];
const baseEN = [
  'fuck','shit','asshole','bastard','bitch','cunt','dick','pussy','motherfucker','mf','fucker','jerk','retard','retarded','slut','whore','fag','faggot','queer'
];
const baseES = [
  'mierda','carajo','coño','cono','pendejo','pendeja','cabron','cabrón','culero','zorra','puta','puto','gilipollas','maricon','maricón'
];

// Identity/gender-orientation sensitive terms (minimize false positives)
const identityPT = [
  'gay',
  'traveco',
  'sapatao','sapatão'
];
const identityEN = [
  'tranny','shemale','dyke'
];
const identityES = [
  'travelo'
];

// Build normalized lookup (lowercase, diacritics removed)
const normalizeWord = (w) => removeDiacritics(String(w).toLowerCase().trim());
const PROFANITY_SET = new Set([...basePT, ...baseEN, ...baseES].map(normalizeWord));
const IDENTITY_SET = new Set([...identityPT, ...identityEN, ...identityES].map(normalizeWord));
// Optional: load extra dictionaries from local files if present
try {
  const fs = require('fs');
  const path = require('path');
  const dictDir = path.join(__dirname, 'profanity');
  const files = ['pt.txt', 'en.txt', 'es.txt'];
  for (const f of files) {
    const p = path.join(dictDir, f);
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        raw.split(/\r?\n/).forEach((w) => {
          const nw = normalizeWord(w);
          if (nw) PROFANITY_SET.add(nw);
        });
      } catch (_) {}
    }
  }
} catch (_) {}
const PROFANITY_LIST = Array.from(PROFANITY_SET);

function normalizeForScan(text = '') {
  const low = removeDiacritics(String(text).toLowerCase());
  // keep letters, numbers and spaces
  return low.replace(/[^a-z0-9áéíóúâêôãõçñü\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function squeezeDuplicates(text = '') {
  // reduce repeated characters to a single occurrence: fuuuuuck -> fuck
  return String(text).replace(/([a-z0-9])\1{1,}/gi, '$1');
}

// Map common leetspeak to base letters (after diacritics removed)
function normalizeLeet(text = '') {
  const map = {
    '@': 'a', '4': 'a',
    '3': 'e', '€': 'e',
    '1': 'i', '!': 'i',
    '0': 'o', '°': 'o',
    '$': 's', '5': 's',
    '7': 't',
    '8': 'b',
    '9': 'g',
    '(': 'c', '{': 'c', '[': 'c',
    '|': 'l'
  };
  let out = '';
  for (const ch of String(text)) {
    out += map[ch] || ch;
  }
  return out;
}

function containsProfanity(text = '') {
  if (!text) return null;
  // lower + remove diacritics + leet mapping
  const prepared = normalizeLeet(removeDiacritics(String(text).toLowerCase()));
  // tokenize by whitespace, then deobfuscate each token (keep within-token separators)
  const tokens = prepared.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    // raw token equality first
    if (PROFANITY_SET.has(normalizeWord(t))) {
      return { code: 'profanity', match: t };
    }
    // remove non-alphanum inside token and squeeze duplicates (catch p.o.r.r.a, f*u*c*k, porr@)
    const deobf = squeezeDuplicates(t.replace(/[^a-z0-9]+/gi, ''));
    if (deobf && PROFANITY_SET.has(normalizeWord(deobf))) {
      return { code: 'profanity', match: deobf };
    }
  }
  return null;
}

function containsIdentitySensitive(text = '') {
  if (!text) return null;
  const prepared = normalizeLeet(removeDiacritics(String(text).toLowerCase()));
  const tokens = prepared.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (IDENTITY_SET.has(normalizeWord(t))) return { code: 'identity', match: t };
    const deobf = squeezeDuplicates(t.replace(/[^a-z0-9]+/gi, ''));
    if (deobf && IDENTITY_SET.has(normalizeWord(deobf))) return { code: 'identity', match: deobf };
  }
  return null;
}

function detectEmail(text = '') {
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const m = emailRegex.exec(text);
  return m ? { code: 'email', match: m[0] } : null;
}

function detectURL(text = '') {
  const patterns = [
    /\bhttps?:\/\/[^\s]+/i,
    /\bwww\.[^\s]+/i,
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[^\s]*)?/i
  ];
  for (const re of patterns) {
    const m = re.exec(String(text));
    if (m) return { code: 'url', match: m[0] };
  }
  return null;
}

function countDigits(text = '') { return (String(text).match(/\d/g) || []).length; }
function longestDigitRun(text = '') {
  let max = 0, cur = 0;
  for (const ch of String(text)) {
    if (ch >= '0' && ch <= '9') { cur++; if (cur > max) max = cur; }
    else cur = 0;
  }
  return max;
}

function detectPhoneLike(text = '') {
  // Block if there is any digit run with 6+ digits (e.g. phone fragments) or total digits >= 11
  const run = longestDigitRun(text);
  const total = countDigits(text);
  if (run >= 6 || total >= 11) {
    return { code: 'phone', match: String(text).match(/\d[\d\s().+-]{5,}/)?.[0] || null };
  }
  return null;
}

function onlyDigits(v) { return String(v || '').replace(/\D/g, ''); }
function isValidCPF(cpf) {
  const d = onlyDigits(cpf);
  if (!d || d.length !== 11 || /^([0-9])\1{10}$/.test(d)) return false;
  let sum = 0, rest;
  for (let i = 1; i <= 9; i++) sum += parseInt(d.substring(i - 1, i)) * (11 - i);
  rest = (sum * 10) % 11; if (rest === 10 || rest === 11) rest = 0; if (rest !== parseInt(d.substring(9, 10))) return false;
  sum = 0; for (let i = 1; i <= 10; i++) sum += parseInt(d.substring(i - 1, i)) * (12 - i);
  rest = (sum * 10) % 11; if (rest === 10 || rest === 11) rest = 0; return rest === parseInt(d.substring(10, 11));
}
function detectCPF(text = '') {
  const candidates = String(text).match(/\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[\s-]?\d{2}\b/g);
  if (!candidates) return null;
  for (const c of candidates) {
    if (isValidCPF(c)) return { code: 'cpf', match: c };
  }
  // If no formatted match, try any 11-digit run
  const raw = String(text).match(/\d{11}/g);
  if (raw) {
    for (const c of raw) {
      if (isValidCPF(c)) return { code: 'cpf', match: c };
    }
  }
  return null;
}

function checkProhibitedContent(text = '') {
  const violations = [];
  const vId = containsIdentitySensitive(text); if (vId) violations.push(vId);
  const v1 = containsProfanity(text); if (v1) violations.push(v1);
  const v2 = detectEmail(text); if (v2) violations.push(v2);
  const vUrl = detectURL(text); if (vUrl) violations.push(vUrl);
  const v3 = detectPhoneLike(text); if (v3) violations.push(v3);
  const v4 = detectCPF(text); if (v4) violations.push(v4);
  // Optional: hard cap on too many digits overall (e.g., > 5) to match requirement
  if (countDigits(text) > 5 && !violations.find(v => v.code === 'phone' || v.code === 'cpf')) {
    violations.push({ code: 'too_many_digits', match: null });
  }
  return { ok: violations.length === 0, violations };
}

module.exports = {
  checkProhibitedContent,
  containsProfanity,
  containsIdentitySensitive,
  detectEmail,
  detectURL,
  detectPhoneLike,
  detectCPF,
  isValidCPF,
  countDigits,
  longestDigitRun,
};

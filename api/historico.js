// Busca o histórico de um treinador no ogol.com.br (somente leitura de páginas públicas).
// GET /api/historico?q=<nome>            → { candidatos: [{ nome, url }] }
// GET /api/historico?url=<página ogol>   → { nome, url, linhas: [{ temporada, clube, pais, jogos, vitorias, empates, derrotas }] }
// Os dados são só uma sugestão: o usuário confere e escolhe o que importar.
import { handle, send, requireUser, httpError } from './_lib/core.js';

const BASE = 'https://www.ogol.com.br';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => {
    if (ENT[n.toLowerCase()] != null) return ENT[n.toLowerCase()];
    const k = n.match(/^([a-z])(acute|grave|circ|tilde|uml|cedil)$/i); // á, ç, õ…
    return k ? (k[1] + ({ acute: '\u0301', grave: '\u0300', circ: '\u0302', tilde: '\u0303', uml: '\u0308', cedil: '\u0327' })[k[2].toLowerCase()]).normalize('NFC') : m;
  });
const text = html => decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const int = s => { const n = parseInt(String(s).replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null; };

async function get(url) {
  let r;
  try {
    r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow' });
  } catch (e) { throw httpError(502, 'Não foi possível acessar o ogol.com.br agora.'); }
  if (!r.ok) throw httpError(502, `O ogol.com.br recusou a consulta (código ${r.status}). Use “Colar tabela” como alternativa.`);
  return r.text();
}

function candidatos(html) {
  const out = new Map();
  const re = /<a[^>]+href="(\/treinador\/[a-z0-9-]+\/\d+)(?:\?[^"]*)?"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const nome = text(m[2]);
    if (!nome || /^\d+$/.test(nome)) continue;
    if (!out.has(m[1])) out.set(m[1], { nome, url: BASE + m[1] });
  }
  return [...out.values()].slice(0, 10);
}

function historico(html) {
  // tabela de "Histórico por época": TEMPORADA | EQUIPE | J | V | %V | E | %E | D | %D | ...
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  const tb = tables.find(t => /TEMPORADA/i.test(t) && /%V/.test(t) && /%E/.test(t) && /%D/.test(t));
  if (!tb) return [];
  const linhas = [];
  let temporada = '';
  for (const tr of tb.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi);
    if (!tds || tds.length < 9) continue;
    const t = tds.map(text);
    if (t[0]) temporada = t[0];
    const pais = (tds[1].match(/title="([^"]+)"/) || [])[1];
    const clube = t[1];
    if (!clube || !temporada) continue;
    linhas.push({ temporada, clube, pais: pais ? decode(pais) : '', jogos: int(t[2]), vitorias: int(t[3]), empates: int(t[5]), derrotas: int(t[7]) });
  }
  return linhas;
}

export default handle(async (req, res) => {
  await requireUser(req, 'leitor');
  const q = String(req.query.q || '').trim();
  const url = String(req.query.url || '').trim();
  if (url) {
    const m = url.match(/^https:\/\/(?:www\.)?ogol\.com\.br(\/treinador\/[a-z0-9-]+\/\d+)/i);
    if (!m) throw httpError(400, 'Endereço inválido: use a página do treinador no ogol.com.br.');
    const html = await get(BASE + m[1] + '/historico-por-epoca');
    const nome = text((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]).split('::')[0].trim();
    return send(res, 200, { nome, url: BASE + m[1], linhas: historico(html) });
  }
  if (q.length < 3) throw httpError(400, 'Digite ao menos 3 letras do nome.');
  const html = await get(BASE + '/pesquisa?search_txt=' + encodeURIComponent(q));
  send(res, 200, { candidatos: candidatos(html) });
});

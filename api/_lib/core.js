// Funções compartilhadas pelas rotas da API (não vira rota: a pasta começa com "_").
import { Redis } from '@upstash/redis';
import { createClient } from 'redis';
import crypto from 'node:crypto';

/* ---------- Banco (Redis) ----------
   Aceita qualquer uma das integrações da Vercel:
   - Upstash (REST): variáveis ...KV_REST_API_URL + ...KV_REST_API_TOKEN ou ...UPSTASH_REDIS_REST_URL/TOKEN
     (com ou sem prefixo, ex.: STORAGE_KV_REST_API_URL)
   - Redis via conexão direta: ...REDIS_URL ou ...KV_URL (redis:// ou rediss://) */
export function findEnv(...suffixes) {
  for (const suf of suffixes) {
    if (process.env[suf]) return { name: suf, value: process.env[suf] };
    const k = Object.keys(process.env).find(n => n.endsWith('_' + suf) && process.env[n]);
    if (k) return { name: k, value: process.env[k] };
  }
  return null;
}
const toStr = v => (typeof v === 'string' ? v : JSON.stringify(v));
const fromStr = v => { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };

let _redis = null;
export function redisInfo() {
  const rest = findEnv('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL');
  const tok = findEnv('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN');
  const tcp = findEnv('REDIS_URL', 'KV_URL');
  if (rest && tok) return { tipo: 'upstash-rest', url: rest.value, token: tok.value, vars: [rest.name, tok.name] };
  if (tcp) return { tipo: 'redis', url: tcp.value, vars: [tcp.name] };
  return null;
}
export function redis() {
  if (_redis) return _redis;
  const info = redisInfo();
  if (!info) throw httpError(500, 'Banco de dados não configurado: conecte um banco Redis (Upstash) ao projeto na Vercel e faça Redeploy.');
  if (info.tipo === 'upstash-rest') {
    const r = new Redis({ url: info.url, token: info.token, automaticDeserialization: false });
    _redis = {
      hget: async (k, f) => fromStr(await r.hget(k, f)),
      hgetall: async k => { const o = await r.hgetall(k); if (!o) return null; const out = {}; for (const [a, b] of Object.entries(o)) out[a] = fromStr(b); return out; },
      hset: (k, o) => r.hset(k, Object.fromEntries(Object.entries(o).map(([a, b]) => [a, toStr(b)]))),
      hdel: (k, f) => r.hdel(k, f), incr: k => r.incr(k), expire: (k, s) => r.expire(k, s), del: k => r.del(k),
    };
  } else {
    const client = createClient({ url: info.url });
    client.on('error', e => console.error('Redis', e.message));
    let ready = null;
    const c = async () => { if (!ready) ready = client.connect(); await ready; return client; };
    _redis = {
      hget: async (k, f) => fromStr(await (await c()).hGet(k, f)),
      hgetall: async k => { const o = await (await c()).hGetAll(k); if (!o || !Object.keys(o).length) return null; const out = {}; for (const [a, b] of Object.entries(o)) out[a] = fromStr(b); return out; },
      hset: async (k, o) => (await c()).hSet(k, Object.fromEntries(Object.entries(o).map(([a, b]) => [a, toStr(b)]))),
      hdel: async (k, f) => (await c()).hDel(k, f), incr: async k => (await c()).incr(k),
      expire: async (k, s) => (await c()).expire(k, s), del: async k => (await c()).del(k),
    };
  }
  return _redis;
}
export function blobToken() { const t = findEnv('BLOB_READ_WRITE_TOKEN'); return t ? t.value : undefined; }

export const COLLECTIONS = ['atletas', 'shortlists', 'shortlistsSalvas'];
export const ROLES = ['admin', 'editor', 'leitor'];
const COOKIE = 'ba_sess';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: e.status ? e.message : 'Erro interno do servidor.' });
    }
  };
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = await readRaw(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { throw httpError(400, 'JSON inválido.'); }
}

export async function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

/* ---------- Senhas ---------- */
export function hashPassword(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 32).toString('hex');
  return { salt, hash };
}
export function checkPassword(senha, salt, hash) {
  const h = crypto.scryptSync(String(senha), salt, 32);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === h.length && crypto.timingSafeEqual(h, ref);
}
function safeEqualStr(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- Sessão (cookie assinado) ---------- */
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw httpError(500, 'SESSION_SECRET não configurado (mínimo 16 caracteres).');
  return s;
}
const b64 = s => Buffer.from(s).toString('base64url');
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!safeEqualStr(mac, good)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function getCookie(req, name) {
  const h = req.headers.cookie || '';
  const m = h.split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
export function setSession(res, email) {
  const token = sign({ e: email, exp: Date.now() + MAX_AGE * 1000 });
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`);
}
export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

const norm = e => String(e || '').trim().toLowerCase();
export const normEmail = norm;
export function isEnvAdmin(email) { return !!process.env.ADMIN_EMAIL && norm(email) === norm(process.env.ADMIN_EMAIL); }

export async function getUserRecord(email) {
  const raw = await redis().hget('users', norm(email));
  return raw || null;
}

// Confere email e senha. Devolve { email, nome, papel } ou null.
export async function login(email, senha) {
  email = norm(email);
  if (!email || !senha) return null;
  if (isEnvAdmin(email) && process.env.ADMIN_PASSWORD && safeEqualStr(senha, process.env.ADMIN_PASSWORD)) {
    return { email, nome: 'Administrador', papel: 'admin' };
  }
  const u = await getUserRecord(email);
  if (!u || !u.hash || !checkPassword(senha, u.salt, u.hash)) return null;
  return { email, nome: u.nome || '', papel: ROLES.includes(u.papel) ? u.papel : 'leitor' };
}

// Login com conta Google: confere o token emitido pelo Google e se o email está cadastrado no sistema.
export async function loginGoogle(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw httpError(400, 'Login com Google não configurado.');
  if (!credential || typeof credential !== 'string') throw httpError(400, 'Credencial do Google ausente.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw httpError(401, 'Não foi possível validar a conta Google. Tente de novo.');
  const t = await r.json();
  const okIss = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  if (t.aud !== clientId || !okIss || Number(t.exp) * 1000 < Date.now()) throw httpError(401, 'Credencial do Google inválida.');
  if (t.email_verified !== true && t.email_verified !== 'true') throw httpError(401, 'O email desta conta Google não está verificado.');
  const email = norm(t.email);
  if (isEnvAdmin(email)) return { email, nome: t.name || 'Administrador', papel: 'admin' };
  const u = await getUserRecord(email);
  if (!u) throw httpError(403, `A conta ${email} não está cadastrada. Peça acesso ao administrador do sistema.`);
  if (!u.nome && t.name) await redis().hset('users', { [email]: JSON.stringify({ ...u, nome: String(t.name).slice(0, 80) }) });
  return { email, nome: u.nome || t.name || '', papel: ROLES.includes(u.papel) ? u.papel : 'leitor' };
}

// Usuário da sessão atual (relê o papel a cada chamada, então mudanças valem na hora).
export async function currentUser(req) {
  const p = verify(getCookie(req, COOKIE));
  if (!p) return null;
  if (isEnvAdmin(p.e)) return { email: norm(p.e), nome: 'Administrador', papel: 'admin' };
  const u = await getUserRecord(p.e);
  if (!u) return null;
  return { email: norm(p.e), nome: u.nome || '', papel: ROLES.includes(u.papel) ? u.papel : 'leitor' };
}

export async function requireUser(req, minRole = 'leitor') {
  const u = await currentUser(req);
  if (!u) throw httpError(401, 'Faça login para continuar.');
  const rank = { leitor: 0, editor: 1, admin: 2 };
  if (rank[u.papel] < rank[minRole]) throw httpError(403, 'Seu usuário não tem permissão para esta ação.');
  return u;
}

export const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

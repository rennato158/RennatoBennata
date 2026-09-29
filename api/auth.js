// GET  /api/auth            → usuário logado (ou 401)
// POST /api/auth?acao=login  { email, senha }
// POST /api/auth?acao=logout
// POST /api/auth?acao=google { credential }  (login com conta Google)
// GET  /api/auth?acao=config                → { googleClientId }
import { handle, send, readJson, login, loginGoogle, setSession, clearSession, currentUser, httpError, redis, getUserRecord, checkPassword, hashPassword, isEnvAdmin } from './_lib/core.js';

export default handle(async (req, res) => {
  if (req.method === 'GET' && req.query.acao === 'config') {
    return send(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
  }
  if (req.method === 'GET') {
    const u = await currentUser(req);
    if (!u) return send(res, 401, { error: 'Não autenticado.' });
    return send(res, 200, { user: u });
  }
  if (req.method !== 'POST') throw httpError(405, 'Método não permitido.');
  const acao = req.query.acao;
  if (acao === 'logout') { clearSession(res); return send(res, 200, { ok: true }); }
  if (acao === 'senha') {
    const u = await currentUser(req);
    if (!u) throw httpError(401, 'Faça login para continuar.');
    if (isEnvAdmin(u.email)) throw httpError(400, 'A senha do administrador principal é alterada na variável ADMIN_PASSWORD da Vercel.');
    const { atual, nova } = await readJson(req);
    const rec = await getUserRecord(u.email);
    if (!rec || !checkPassword(atual || '', rec.salt, rec.hash)) throw httpError(400, 'Senha atual incorreta.');
    if (!nova || String(nova).length < 8) throw httpError(400, 'A nova senha precisa ter pelo menos 8 caracteres.');
    await redis().hset('users', { [u.email]: JSON.stringify({ ...rec, ...hashPassword(nova) }) });
    return send(res, 200, { ok: true });
  }
  if (acao === 'google') {
    const { credential } = await readJson(req);
    const u = await loginGoogle(credential);
    setSession(res, u.email);
    return send(res, 200, { user: u });
  }
  if (acao !== 'login') throw httpError(400, 'Ação inválida.');

  const { email, senha } = await readJson(req);
  // limite simples contra tentativas repetidas: 10 por email a cada 15 min
  const key = 'tentativas:' + String(email || '').toLowerCase();
  const n = await redis().incr(key);
  if (n === 1) await redis().expire(key, 900);
  if (n > 10) throw httpError(429, 'Muitas tentativas. Aguarde alguns minutos.');

  const u = await login(email, senha);
  if (!u) throw httpError(401, 'Email ou senha incorretos.');
  await redis().del(key);
  setSession(res, u.email);
  send(res, 200, { user: u });
});

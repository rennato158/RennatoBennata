// Gestão de usuários (somente administrador).
// GET    /api/users                          → { users: [{ email, nome, papel }] }
// POST   /api/users  { email, nome, papel, senha? } → cria ou atualiza (sem senha = entra só com a conta Google)
// DELETE /api/users?email=...
import { handle, send, readJson, requireUser, httpError, redis, hashPassword, normEmail, isEnvAdmin, ROLES } from './_lib/core.js';

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

export default handle(async (req, res) => {
  const me = await requireUser(req, 'admin');
  if (req.method === 'GET') {
    const all = (await redis().hgetall('users')) || {};
    const users = Object.entries(all).map(([email, v]) => { const u = parse(v); return { email, nome: u.nome || '', papel: u.papel, senha: !!u.hash }; })
      .sort((a, b) => a.email.localeCompare(b.email));
    return send(res, 200, { users, adminPrincipal: process.env.ADMIN_EMAIL || '' });
  }
  if (req.method === 'DELETE') {
    const email = normEmail(req.query.email);
    if (email === me.email) throw httpError(400, 'Você não pode remover o próprio acesso.');
    await redis().hdel('users', email);
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'POST') throw httpError(405, 'Método não permitido.');
  const { email: e, nome = '', papel = 'leitor', senha } = await readJson(req);
  const email = normEmail(e);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Email inválido.');
  if (isEnvAdmin(email)) throw httpError(400, 'Este é o administrador principal (definido nas variáveis da Vercel).');
  if (!ROLES.includes(papel)) throw httpError(400, 'Papel inválido.');
  const cur = parse(await redis().hget('users', email));
  if (senha && String(senha).length < 8) throw httpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
  const rec = { ...(cur || {}), nome: String(nome).slice(0, 80), papel };
  if (senha) Object.assign(rec, hashPassword(senha));
  await redis().hset('users', { [email]: JSON.stringify(rec) });
  send(res, 200, { ok: true, criado: !cur });
});

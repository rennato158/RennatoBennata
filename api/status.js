// GET /api/status → diagnóstico da configuração (não mostra segredos).
// Abra https://SEU-ENDERECO.vercel.app/api/status no navegador para conferir.
import { handle, send, redis, redisInfo, blobToken, currentUser, findEnv } from './_lib/core.js';

export default handle(async (req, res) => {
  const info = redisInfo();
  const out = {
    bancoDeDados: info ? `${info.tipo} (${info.vars.join(', ')})` : 'NÃO CONFIGURADO — conecte o Upstash Redis na aba Storage e faça Redeploy',
    bancoConecta: false,
    fotos: blobToken() ? 'ok (' + (findEnv('BLOB_READ_WRITE_TOKEN') || {}).name + ')' : 'NÃO CONFIGURADO — crie um Blob store na aba Storage e faça Redeploy',
    adminEmail: process.env.ADMIN_EMAIL ? 'ok' : 'FALTANDO',
    adminPassword: process.env.ADMIN_PASSWORD ? 'ok' : 'FALTANDO',
    sessionSecret: (process.env.SESSION_SECRET || '').length >= 16 ? 'ok' : 'FALTANDO ou curto (mínimo 16 caracteres)',
    loginGoogle: process.env.GOOGLE_CLIENT_ID ? 'ok' : 'desativado (GOOGLE_CLIENT_ID não definido)',
  };
  if (info) {
    try {
      await redis().hget('diag', 'x'); out.bancoConecta = true;
      const u = await currentUser(req).catch(() => null);
      if (u) { const all = (await redis().hgetall('col:atletas')) || {}; out.atletasNoBanco = Object.keys(all).length; }
    } catch (e) { out.bancoConecta = 'ERRO: ' + e.message; }
  }
  send(res, 200, out);
});

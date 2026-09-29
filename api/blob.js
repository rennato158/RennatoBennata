// GET /_blob/<id>  (reescrito para /api/blob?id=<id>) → devolve a foto pelo próprio domínio,
// só para usuários logados. Servir pelo mesmo domínio permite recortar e gerar PDF com a foto.
import { handle, requireUser, httpError, redis } from './_lib/core.js';

export default handle(async (req, res) => {
  await requireUser(req, 'leitor');
  const id = String(req.query.id || '');
  if (!/^[a-f0-9]{32}$/.test(id)) throw httpError(404, 'Foto não encontrada.');
  const url = await redis().hget('blobs', id);
  if (!url) throw httpError(404, 'Foto não encontrada.');
  const r = await fetch(url);
  if (!r.ok) throw httpError(404, 'Foto não encontrada.');
  const buf = Buffer.from(await r.arrayBuffer());
  res.statusCode = 200;
  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.end(buf);
});

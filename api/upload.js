// POST   /api/upload           (corpo = bytes da imagem, header x-type = tipo) → { id, url }
// DELETE /api/upload?id=...    → remove a foto
import { put, del } from '@vercel/blob';
import crypto from 'node:crypto';
import { handle, send, readRaw, requireUser, httpError, redis, blobToken } from './_lib/core.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export default handle(async (req, res) => {
  await requireUser(req, 'editor');
  if (req.method === 'DELETE') {
    const id = String(req.query.id || '');
    if (!/^[a-f0-9]{32}$/.test(id)) throw httpError(400, 'Identificador inválido.');
    const url = await redis().hget('blobs', id);
    if (url) { try { await del(url, { token: blobToken() }); } catch (e) { console.error(e); } await redis().hdel('blobs', id); }
    return send(res, 200, { deleted: !!url });
  }
  if (req.method !== 'POST') throw httpError(405, 'Método não permitido.');
  if (!blobToken()) throw httpError(500, 'Armazenamento de fotos não configurado: crie um Blob store na aba Storage da Vercel, conecte ao projeto e faça Redeploy.');
  const type = String(req.headers['x-type'] || '').split(';')[0].trim();
  if (!TYPES[type]) throw httpError(415, 'Formato não aceito. Use JPG, PNG, WEBP ou GIF.');
  const buf = await readRaw(req);
  if (!buf.length) throw httpError(400, 'Arquivo vazio.');
  if (buf.length > 4_000_000) throw httpError(413, 'Arquivo grande demais (máx. 4 MB).');
  const id = crypto.randomBytes(16).toString('hex');
  const blob = await put(`fotos/${id}.${TYPES[type]}`, buf, { access: 'public', contentType: type, addRandomSuffix: true, token: blobToken() });
  await redis().hset('blobs', { [id]: blob.url });
  send(res, 200, { id, url: '/_blob/' + id, sizeBytes: buf.length, contentType: type });
});

// Documentos das coleções (atletas, shortlists, shortlistsSalvas).
// GET    /api/data?col=atletas              → { docs: [{ id, data }] }   (qualquer usuário logado)
// PUT    /api/data?col=atletas&id=x  {...}  → substitui o documento        (editor/admin)
// PATCH  /api/data?col=atletas&id=x  {...}  → mescla campos                (editor/admin)
// DELETE /api/data?col=atletas&id=x         → apaga                        (editor/admin)
import { handle, send, readJson, requireUser, httpError, redis, COLLECTIONS, ID_RE } from './_lib/core.js';

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

export default handle(async (req, res) => {
  const col = req.query.col;
  if (!COLLECTIONS.includes(col)) throw httpError(400, 'Coleção inválida.');
  const key = 'col:' + col;

  if (req.method === 'GET') {
    await requireUser(req, 'leitor');
    const all = (await redis().hgetall(key)) || {};
    const docs = Object.entries(all).map(([id, v]) => ({ id, data: parse(v) }));
    return send(res, 200, { docs });
  }

  await requireUser(req, 'editor');
  const id = req.query.id;
  if (!ID_RE.test(id || '')) throw httpError(400, 'Identificador inválido.');

  if (req.method === 'DELETE') {
    await redis().hdel(key, id);
    return send(res, 200, { ok: true });
  }
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Documento inválido.');
  let data = body;
  if (req.method === 'PATCH') {
    const cur = parse(await redis().hget(key, id)) || {};
    data = { ...cur, ...body };
    for (const [k, v] of Object.entries(body)) if (v && typeof v === 'object' && v.__delete__ === true) delete data[k];
  } else if (req.method !== 'PUT') throw httpError(405, 'Método não permitido.');
  const json = JSON.stringify(data);
  if (json.length > 900_000) throw httpError(413, 'Documento grande demais.');
  await redis().hset(key, { [id]: json });
  send(res, 200, { ok: true });
});

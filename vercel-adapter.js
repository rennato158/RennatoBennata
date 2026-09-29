/* Banco de Atletas — adaptador para a versão publicada na Vercel.
   Oferece à página a mesma interface que ela usa dentro do Claude
   (claude.use('db' | 'assets' | 'downloads' | 'user')), mas falando com a API
   própria do projeto (/api/*), com login por email e senha. */
(function () {
  if (window.claude && window.claude.use) return; // dentro do Claude, usa o nativo

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(method, url, body, headers) {
    const opt = { method, credentials: 'same-origin', headers: { ...(headers || {}) } };
    if (body instanceof Blob) { opt.body = body; opt.headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    const r = await fetch(url, opt);
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) {
      const err = { status: r.status, message: j.error || 'Falha na comunicação com o servidor.' };
      err.code = r.status === 401 || r.status === 403 ? 'invalid_argument' : r.status === 413 ? 'too_large' : r.status === 415 ? 'unsupported_type' : r.status === 429 ? 'rate_limited' : 'unavailable';
      if (r.status === 401) showLogin('Sua sessão expirou. Entre novamente.');
      else if (!(method === 'POST' && url.includes('acao=google'))) banner(err.message);
      throw err;
    }
    return j;
  }

  // Aviso fixo no topo quando o servidor recusa ou falha (mostra o motivo real)
  function banner(msg) {
    let b = document.getElementById('baBanner');
    if (!b) { b = document.createElement('div'); b.id = 'baBanner'; b.setAttribute('role', 'alert');
      b.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:120;max-width:calc(100% - 24px);background:#3A1A18;color:#FFD9DC;border:1px solid #FF7A85;border-radius:10px;padding:10px 14px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);cursor:pointer';
      b.onclick = () => { b.hidden = true; }; document.body.appendChild(b); }
    b.textContent = msg + '  (toque para fechar)'; b.hidden = false;
    clearTimeout(banner._t); banner._t = setTimeout(() => { b.hidden = true; }, 12000);
  }

  /* ---------- Login ---------- */
  let ME = null, loginResolve = null;
  const loginReady = new Promise(r => { loginResolve = r; });

  const css = `
  #baLogin{position:fixed;inset:0;z-index:100;display:grid;grid-template-columns:1.1fr 1fr;background:var(--bg,#08070B);overflow:auto}
  #baLogin .brand{position:relative;overflow:hidden;padding:48px clamp(24px,5vw,64px);display:flex;flex-direction:column;justify-content:space-between;gap:28px;
    background:radial-gradient(90% 70% at 20% 0,rgba(139,92,246,.35),transparent 60%),radial-gradient(80% 60% at 100% 100%,rgba(76,29,149,.45),transparent 60%),#0B0912;color:#F3F0FA}
  #baLogin .brand svg.field{position:absolute;right:-8%;bottom:-6%;width:78%;max-width:620px;opacity:.35;color:#B794FF;pointer-events:none}
  #baLogin .brand h1{font-family:var(--display);font-weight:700;text-transform:uppercase;font-size:clamp(40px,6vw,76px);line-height:.92;margin:10px 0 0;letter-spacing:.01em}
  #baLogin .brand h1 span{color:#B794FF}
  #baLogin .brand .eyebrow{color:#B794FF}
  #baLogin .brand p{max-width:420px;color:#B9B2CC;margin:14px 0 0;font-size:15px;line-height:1.55}
  #baLogin .feats{display:flex;flex-wrap:wrap;gap:8px;position:relative}
  #baLogin .feats span{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;border:1px solid rgba(183,148,255,.35);color:#D8CCFF;border-radius:999px;padding:5px 11px;background:rgba(8,7,11,.4)}
  #baLogin .side{display:grid;place-items:center;padding:32px 20px;background:var(--bg,#08070B)}
  #baLogin .box{width:min(380px,100%);display:flex;flex-direction:column;gap:14px}
  #baLogin .box h2{font-family:var(--display);font-size:30px;text-transform:uppercase;margin:0;line-height:1;color:var(--ink)}
  #baLogin .box .lead{color:var(--ink-2);margin:0;font-size:14px}
  #baLogin #baGoogle{min-height:44px;display:flex;justify-content:center}
  #baLogin .or{display:flex;align-items:center;gap:10px;color:var(--ink-3);font-size:12px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase}
  #baLogin .or::before,#baLogin .or::after{content:"";flex:1;height:1px;background:var(--line-2)}
  #baLogin .err{color:var(--danger,#FF7A85);font-size:13px;min-height:18px}
  #baLogin .toggle{background:none;border:0;color:var(--accent-2);cursor:pointer;font-size:13px;padding:0;text-align:left}
  @media (max-width:820px){ #baLogin{grid-template-columns:1fr;grid-template-rows:auto 1fr} #baLogin .brand{padding:32px 20px 28px} #baLogin .brand svg.field{width:120%;right:-40%;opacity:.22} #baLogin .brand p{display:none} #baLogin .side{place-items:start center;padding-top:28px} }
  .ba-user{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-2);border:1px solid var(--line-2);border-radius:999px;padding:4px 6px 4px 12px}
  .ba-user b{color:var(--ink);font-weight:600}
  .ba-user .papel{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-2)}
  .ba-user button{border:0;background:var(--surface-2);color:var(--ink-2);border-radius:999px;padding:4px 10px;cursor:pointer;font-size:12px}
  .ba-user button:hover{color:var(--ink);background:var(--surface-3)}
  #baUsers table{min-width:0;width:100%}
  #baUsers td,#baUsers th{padding:8px 6px;font-size:13px}
  #baUsers th{position:static;cursor:default}
  `;
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  });

  let GOOGLE_ID = '';
  const FIELD_SVG = `<svg class="field" viewBox="0 0 400 260" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="4" y="4" width="392" height="252" rx="3"/><line x1="200" y1="4" x2="200" y2="256"/><circle cx="200" cy="130" r="38"/><circle cx="200" cy="130" r="2.5" fill="currentColor"/><rect x="4" y="68" width="62" height="124"/><rect x="4" y="100" width="22" height="60"/><rect x="334" y="68" width="62" height="124"/><rect x="374" y="100" width="22" height="60"/><circle cx="96" cy="84" r="5" fill="currentColor" stroke="none"/><circle cx="96" cy="176" r="5" fill="currentColor" stroke="none"/><circle cx="150" cy="130" r="5" fill="currentColor" stroke="none"/><circle cx="252" cy="92" r="5" fill="currentColor" stroke="none"/><circle cx="252" cy="168" r="5" fill="currentColor" stroke="none"/><circle cx="310" cy="130" r="5" fill="currentColor" stroke="none"/><path d="M96 84 150 130 252 92 310 130M96 176 150 130 252 168" opacity=".45" stroke-dasharray="4 5"/></svg>`;

  async function afterLogin(user) {
    const wasLogged = !!ME; ME = user; $('#baLogin').hidden = true;
    if ($('#baSenha')) $('#baSenha').value = '';
    if (wasLogged) location.reload(); else { loginResolve(); mountUserBar(); }
  }
  function setupGoogle() {
    if (!GOOGLE_ID) return;
    const render = () => {
      try {
        google.accounts.id.initialize({ client_id: GOOGLE_ID, ux_mode: 'popup', auto_select: false,
          callback: async resp => {
            $('#baErr').textContent = '';
            try { const j = await api('POST', '/api/auth?acao=google', { credential: resp.credential }); afterLogin(j.user); }
            catch (err) { $('#baErr').textContent = err.message; }
          } });
        const light = document.documentElement.getAttribute('data-mode') === 'light';
        google.accounts.id.renderButton($('#baGoogle'), { type: 'standard', theme: light ? 'outline' : 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', locale: 'pt-BR', width: Math.min(380, $('#baGoogle').clientWidth || 340) });
      } catch (e) { $('#baGoogle').innerHTML = '<div class="hint">Não foi possível carregar o login do Google.</div>'; }
    };
    if (window.google && google.accounts) return render();
    const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.defer = true;
    sc.onload = render; sc.onerror = () => { $('#baGoogle').innerHTML = '<div class="hint">Não foi possível carregar o login do Google.</div>'; };
    document.head.appendChild(sc);
  }

  function showLogin(msg) {
    let el = $('#baLogin');
    if (!el) {
      el = document.createElement('div'); el.id = 'baLogin';
      el.innerHTML = `<section class="brand">${FIELD_SVG}
          <div style="position:relative"><div class="eyebrow">Observação técnica · Anderson Batatais</div>
          <h1>Banco de<br><span>Atletas</span></h1>
          <p>Cadastro de atletas, campograma por função, timeline de status e shortlist por sistema de jogo, com relatórios em PDF e Excel.</p></div>
          <div class="feats"><span>Cadastro</span><span>Campograma</span><span>Shortlist</span><span>PDF e Excel</span></div>
        </section>
        <section class="side"><div class="box">
          <div><h2>Entrar</h2><p class="lead">Use a conta Google ou o email cadastrado pelo administrador.</p></div>
          <div id="baGoogleWrap"><div id="baGoogle"></div></div>
          <div class="or" id="baOr">ou</div>
          <button type="button" class="toggle" id="baShowPass">Entrar com email e senha</button>
          <form id="baForm" novalidate hidden style="display:flex;flex-direction:column;gap:12px">
            <div class="f"><label for="baEmail">Email</label><input id="baEmail" type="email" autocomplete="username" required></div>
            <div class="f"><label for="baSenha">Senha</label><input id="baSenha" type="password" autocomplete="current-password" required></div>
            <button class="btn primary" type="submit" style="justify-content:center">Entrar</button>
          </form>
          <div class="err" id="baErr" role="alert"></div>
          <div class="hint" style="margin:0">Acesso restrito a contas cadastradas. Peça seu acesso ao administrador do sistema.</div>
        </div></section>`;
      document.body.appendChild(el);
      const form = el.querySelector('#baForm');
      el.querySelector('#baShowPass').onclick = () => { form.hidden = false; el.querySelector('#baShowPass').hidden = true; setTimeout(() => $('#baEmail').focus(), 30); };
      if (!GOOGLE_ID) { el.querySelector('#baGoogleWrap').hidden = true; el.querySelector('#baOr').hidden = true; el.querySelector('#baShowPass').hidden = true; form.hidden = false; }
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]'); btn.disabled = true; $('#baErr').textContent = '';
        try {
          const r = await fetch('/api/auth?acao=login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: $('#baEmail').value, senha: $('#baSenha').value }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Não foi possível entrar.');
          afterLogin(j.user);
        } catch (err) { $('#baErr').textContent = err.message; }
        finally { btn.disabled = false; }
      });
      setupGoogle();
    }
    el.hidden = false;
    if (msg) $('#baErr').textContent = msg;
  }

  async function boot() {
    try { const c = await fetch('/api/auth?acao=config', { credentials: 'same-origin' }); if (c.ok) GOOGLE_ID = (await c.json()).googleClientId || ''; } catch (e) {}
    try {
      const r = await fetch('/api/auth', { credentials: 'same-origin' });
      if (r.ok) { ME = (await r.json()).user; loginResolve(); mountUserBar(); return; }
    } catch (e) {}
    showLogin();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  function mountUserBar() {
    const bar = document.querySelector('header.top .actions');
    if (!bar || $('#baUserBar')) return;
    const papel = { admin: 'Administrador', editor: 'Editor', leitor: 'Leitura' }[ME.papel] || ME.papel;
    const el = document.createElement('div'); el.id = 'baUserBar'; el.className = 'ba-user';
    el.innerHTML = `<span><b>${esc(ME.nome || ME.email)}</b> · <span class="papel">${esc(papel)}</span></span>` +
      (ME.papel === 'admin' ? `<button type="button" id="baUsersBtn">Usuários</button>` : `<button type="button" id="baPassBtn">Senha</button>`) +
      `<button type="button" id="baOut">Sair</button>`;
    bar.prepend(el);
    $('#baOut').onclick = async () => { try { await fetch('/api/auth?acao=logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {} location.reload(); };
    if ($('#baUsersBtn')) $('#baUsersBtn').onclick = openUsers;
    if ($('#baPassBtn')) $('#baPassBtn').onclick = openPass;
  }

  /* ---------- Usuários (admin) ---------- */
  function modal(id, title, inner) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'picker'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.appendChild(el);
      el.addEventListener('click', e => { if (e.target === el) el.hidden = true; }); }
    el.innerHTML = `<div class="pk-box" style="width:min(620px,100%)"><div class="pk-head"><div><div class="eyebrow">Acesso ao sistema</div><h3>${title}</h3></div><button type="button" class="btn" data-close>Fechar</button></div>${inner}</div>`;
    el.querySelector('[data-close]').onclick = () => { el.hidden = true; };
    el.hidden = false; return el;
  }
  async function openUsers() {
    const el = modal('baUsers', 'Usuários', `
      <div class="hint" style="margin:0"><b>Editor</b> cadastra e altera atletas e shortlists. <b>Leitura</b> só consulta e exporta. <b>Administrador</b> também gerencia usuários.</div>
      <div class="car-tw" style="overflow:auto;max-height:240px"><table><thead><tr><th>Email</th><th>Nome</th><th>Papel</th><th>Acesso</th><th></th></tr></thead><tbody id="baUList"><tr><td colspan="5">Carregando…</td></tr></tbody></table></div>
      <div class="section-t">Adicionar ou alterar usuário</div>
      <div class="fs">
        <div class="f s3"><label for="uEmail">Email</label><input id="uEmail" type="email" autocomplete="off"></div>
        <div class="f s3"><label for="uNome">Nome</label><input id="uNome" autocomplete="off"></div>
        <div class="f s3"><label for="uPapel">Papel</label><select id="uPapel"><option value="editor">Editor</option><option value="leitor">Leitura</option><option value="admin">Administrador</option></select></div>
        <div class="f s3"><label for="uSenha">Senha (opcional, mín. 8)</label><input id="uSenha" type="text" autocomplete="off"></div>
      </div>
      <div class="hint" style="margin:0">Sem senha, a pessoa entra só com a conta Google desse email. Ao editar um usuário, deixe a senha em branco para manter a atual.</div>
      <div class="hint" id="uMsg" style="margin:0"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn primary" id="uSave">Salvar usuário</button></div>`);
    async function load() {
      try {
        const { users, adminPrincipal } = await api('GET', '/api/users');
        el.querySelector('#baUList').innerHTML = (adminPrincipal ? `<tr><td>${esc(adminPrincipal)}</td><td>Administrador principal</td><td>Administrador</td><td>Google e senha</td><td></td></tr>` : '') +
          users.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.nome)}</td><td>${{ admin: 'Administrador', editor: 'Editor', leitor: 'Leitura' }[u.papel] || esc(u.papel)}</td><td>${u.senha ? 'Google e senha' : 'Google'}</td>
            <td style="white-space:nowrap"><button type="button" class="btn" data-ed="${esc(u.email)}" data-n="${esc(u.nome)}" data-p="${esc(u.papel)}" style="padding:4px 10px;min-height:0">Editar</button>
            <button type="button" class="btn danger" data-rm="${esc(u.email)}" style="padding:4px 10px;min-height:0">Remover</button></td></tr>`).join('');
      } catch (e) { el.querySelector('#baUList').innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`; }
    }
    el.querySelector('#baUList').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ed) { el.querySelector('#uEmail').value = b.dataset.ed; el.querySelector('#uNome').value = b.dataset.n; el.querySelector('#uPapel').value = b.dataset.p; el.querySelector('#uSenha').value = ''; el.querySelector('#uNome').focus(); }
      if (b.dataset.rm) {
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Confirmar'; return; }
        try { await api('DELETE', '/api/users?email=' + encodeURIComponent(b.dataset.rm)); load(); } catch (err) { el.querySelector('#uMsg').textContent = err.message; }
      }
    });
    el.querySelector('#uSave').onclick = async () => {
      const m = el.querySelector('#uMsg'); m.textContent = '';
      try {
        const r = await api('POST', '/api/users', { email: el.querySelector('#uEmail').value, nome: el.querySelector('#uNome').value, papel: el.querySelector('#uPapel').value, senha: el.querySelector('#uSenha').value || undefined });
        m.textContent = r.criado ? 'Usuário criado. Envie o endereço do sistema para a pessoa (e a senha, se definiu uma).' : 'Usuário atualizado.';
        ['#uEmail', '#uNome', '#uSenha'].forEach(s => el.querySelector(s).value = ''); load();
      } catch (err) { m.textContent = err.message; }
    };
    load();
  }
  function openPass() {
    const el = modal('baPass', 'Trocar senha', `
      <div class="fs"><div class="f"><label for="pAtual">Senha atual</label><input id="pAtual" type="password" autocomplete="current-password"></div>
      <div class="f"><label for="pNova">Nova senha (mín. 8)</label><input id="pNova" type="password" autocomplete="new-password"></div></div>
      <div class="hint" id="pMsg" style="margin:0"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn primary" id="pSave">Salvar nova senha</button></div>`);
    el.querySelector('#pSave').onclick = async () => {
      const m = el.querySelector('#pMsg');
      try { await api('POST', '/api/auth?acao=senha', { atual: el.querySelector('#pAtual').value, nova: el.querySelector('#pNova').value }); m.textContent = 'Senha alterada.'; }
      catch (err) { m.textContent = err.message; }
    };
  }

  /* ---------- db (mesma interface usada pela página) ---------- */
  const subs = {}; // col -> { docs, listeners:Set }
  const POLL = 30000;
  function snapDoc(col, id) {
    const d = (subs[col] && subs[col].docs || []).find(x => x.id === id);
    return { id, exists: !!d, data: () => (d ? d.data : undefined), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function snapCol(col) {
    const docs = (subs[col].docs || []).map(d => ({ id: d.id, exists: true, data: () => d.data, metadata: {} }));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }
  async function refresh(col) {
    const s = subs[col] || (subs[col] = { docs: [], listeners: new Set(), timer: null });
    const { docs } = await api('GET', '/api/data?col=' + encodeURIComponent(col));
    s.docs = docs;
    s.listeners.forEach(l => { try { l.id ? l.fn(snapDoc(col, l.id)) : l.fn(snapCol(col)); } catch (e) { console.error(e); } });
  }
  function subscribe(col, id, fn, onErr) {
    const s = subs[col] || (subs[col] = { docs: [], listeners: new Set(), timer: null });
    const l = { id, fn }; s.listeners.add(l);
    refresh(col).catch(e => onErr && onErr(e));
    if (!s.timer) s.timer = setInterval(() => { if (!document.hidden) refresh(col).catch(() => {}); }, POLL);
    return () => { s.listeners.delete(l); };
  }
  window.addEventListener('focus', () => Object.keys(subs).forEach(c => refresh(c).catch(() => {})));
  function docRef(col, id) {
    return {
      id, path: col + '/' + id,
      get: async () => { await refresh(col); return snapDoc(col, id); },
      set: async data => { await api('PUT', `/api/data?col=${encodeURIComponent(col)}&id=${encodeURIComponent(id)}`, data); refresh(col).catch(() => {}); },
      update: async data => { await api('PATCH', `/api/data?col=${encodeURIComponent(col)}&id=${encodeURIComponent(id)}`, data); refresh(col).catch(() => {}); },
      delete: async () => { await api('DELETE', `/api/data?col=${encodeURIComponent(col)}&id=${encodeURIComponent(id)}`); refresh(col).catch(() => {}); },
      onSnapshot: (fn, err) => subscribe(col, id, fn, err),
    };
  }
  function colRef(col) {
    return {
      path: col,
      doc: id => docRef(col, id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8))),
      add: async data => { const r = docRef(col, Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); await r.set(data); return r; },
      get: async () => { await refresh(col); return snapCol(col); },
      onSnapshot: (fn, err) => subscribe(col, null, fn, err),
      where() { return this; }, orderBy() { return this; }, limit() { return this; },
    };
  }
  const db = { collection: colRef, doc: path => { const [c, i] = String(path).split('/'); return docRef(c, i); } };

  const assets = {
    upload: async (blob, opts = {}) => api('POST', '/api/upload', blob, { 'x-type': opts.type || blob.type || 'image/jpeg' }),
    delete: async id => api('DELETE', '/api/upload?id=' + encodeURIComponent(String(id).replace(/^\/_blob\//, ''))),
    list: async () => ({ assets: [], usage: {} }),
  };

  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: 'saved' };
    },
  };

  const user = {
    isOwner: async () => !!ME && ME.papel === 'admin',
    canEdit: async () => !!ME && ME.papel !== 'leitor',
    can: async n => (n === 'data.write' || n === 'assets.write' || n === 'files.write') ? (!!ME && ME.papel !== 'leitor') : false,
    me: async () => ({ id: ME ? ME.email : null, name: ME ? (ME.nome || '') : '', email: ME ? ME.email : null }),
    id: async () => (ME ? ME.email : null),
  };

  window.claude = {
    use: async name => {
      await loginReady;
      if (name === 'db') return db;
      if (name === 'assets') return ME && ME.papel !== 'leitor' ? assets : null;
      if (name === 'downloads') return downloads;
      if (name === 'user') return user;
      return null;
    },
  };
})();

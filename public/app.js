// ============================================================
// PRONOSTIX — single-page app (vanilla)
// ============================================================
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

const store = {
  get token() { return localStorage.getItem('px_token'); },
  set token(v) { v ? localStorage.setItem('px_token', v) : localStorage.removeItem('px_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('px_user')); } catch { return null; } },
  set user(v) { v ? localStorage.setItem('px_user', JSON.stringify(v)) : localStorage.removeItem('px_user'); },
};

// ---------- helpers ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(store.token ? { authorization: 'Bearer ' + store.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { logout(); throw new Error('Session expirée'); }
  let json = null; try { json = await res.json(); } catch {}
  if (!res.ok) throw new Error(json?.error || `Erreur ${res.status}`);
  return json;
}

let toastTimer;
function toast(msg, kind = 'ok') {
  clearTimeout(toastTimer);
  $toast.textContent = msg;
  $toast.className = `toast show ${kind}`;
  $toast.hidden = false;
  toastTimer = setTimeout(() => { $toast.className = 'toast'; }, 2200);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flagUrl = (f) => f ? `/flags/${f}` : null;

function flagImg(side, cls = 'flag') {
  if (side.flag) return `<img class="${cls}" src="${flagUrl(side.flag)}" alt="${esc(side.name)}" loading="lazy" />`;
  return `<div class="${cls} ph">${esc(side.placeholder || '?')}</div>`;
}

const STAGE_FR = { group: 'Poule', R32: '16es de finale', R16: '8es de finale', QF: 'Quarts', SF: 'Demi-finales', '3RD': '3e place', F: 'Finale' };
// All times are shown in Swiss time (Europe/Zurich), whatever the device's timezone.
const TZ = 'Europe/Zurich';
const fmtDay = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
const fmtTime = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dayKey = (iso) => new Intl.DateTimeFormat('fr-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const ROUTES = [
  { id: 'matches', icon: '⚽', label: 'Matchs' },
  { id: 'groupes', icon: '🏟️', label: 'Groupes' },
  { id: 'classement', icon: '🏆', label: 'Classement' },
  { id: 'bonus', icon: '⭐', label: 'Bonus' },
];
const ADMIN_ROUTE = { id: 'admin', icon: '🛠️', label: 'Admin' };

function currentRoute() {
  const r = location.hash.replace('#/', '') || 'matches';
  return r;
}

// ============================================================
// AUTH
// ============================================================
function renderAuth() {
  let mode = 'login';
  $app.innerHTML = `
    <div class="auth">
      <div class="brand">
        <div class="logo">⚽</div>
        <h1>Prono<b>stix</b></h1>
        <p>Pronostics de la Coupe du Monde 2026 — en famille</p>
      </div>
      <div class="panel">
        <div class="toggle">
          <button data-mode="login" class="on">Connexion</button>
          <button data-mode="register">Créer un compte</button>
        </div>
        <form id="authForm">
          <div class="field">
            <label>Pseudo</label>
            <input class="input" id="pseudo" autocomplete="username" placeholder="Ton prénom" maxlength="20" />
          </div>
          <div class="field">
            <label>Code PIN (4 chiffres)</label>
            <div class="pin-row" id="pinRow">
              ${[0, 1, 2, 3].map(i => `<input inputmode="numeric" maxlength="1" data-i="${i}" />`).join('')}
            </div>
          </div>
          <button class="btn" type="submit" id="authBtn">Se connecter</button>
        </form>
        <p style="text-align:center;color:var(--ink-faint);font-size:11.5px;margin-top:14px">Sans email, sans vérification. Choisis un pseudo et un PIN, c'est tout.</p>
      </div>
    </div>`;

  const pins = [...$app.querySelectorAll('#pinRow input')];
  pins.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '');
      if (inp.value && i < 3) pins[i + 1].focus();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && i > 0) pins[i - 1].focus(); });
  });

  $app.querySelectorAll('.toggle button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $app.querySelectorAll('.toggle button').forEach(x => x.classList.toggle('on', x === b));
    $app.querySelector('#authBtn').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  }));

  $app.querySelector('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pseudo = $app.querySelector('#pseudo').value.trim();
    const pin = pins.map(p => p.value).join('');
    if (pseudo.length < 2) return toast('Choisis un pseudo (2 caractères min).', 'err');
    if (!/^\d{4}$/.test(pin)) return toast('Le PIN doit faire 4 chiffres.', 'err');
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const r = await api(path, { method: 'POST', body: { pseudo, pin } });
      store.token = r.token; store.user = r.user;
      location.hash = '#/matches';
      render();
      toast(`Salut ${r.user.pseudo} 👋`);
    } catch (err) { toast(err.message, 'err'); }
  });
}

function logout() {
  store.token = null; store.user = null;
  location.hash = '';
  renderAuth();
}

// ============================================================
// SHELL
// ============================================================
function shell(route) {
  const u = store.user;
  const routes = u?.is_admin ? [...ROUTES, ADMIN_ROUTE] : ROUTES;
  $app.innerHTML = `
    <div class="topbar">
      <div class="wordmark">Prono<b>stix</b></div>
      <div class="who"><strong>${esc(u.pseudo)}</strong><button class="linkish" id="logout">Déconnexion</button></div>
    </div>
    <div id="view"><div class="spinner"></div></div>
    <nav class="nav">
      ${routes.map(r => `<a href="#/${r.id}" class="${r.id === route ? 'on' : ''}"><span class="ic">${r.icon}</span>${r.label}</a>`).join('')}
    </nav>`;
  $app.querySelector('#logout').addEventListener('click', logout);
  return $app.querySelector('#view');
}

// ============================================================
// MATCHES
// ============================================================
const saveTimers = {};
function debounceSave(key, fn, ms = 650) { clearTimeout(saveTimers[key]); saveTimers[key] = setTimeout(fn, ms); }

async function viewMatches(view) {
  const { matches } = await api('/api/matches');
  // group by Swiss day (not the device's timezone)
  const days = [];
  let last = null;
  for (const m of matches) {
    const key = dayKey(m.kickoff);
    if (key !== last) { days.push({ key, label: fmtDay(m.kickoff), items: [] }); last = key; }
    days[days.length - 1].items.push(m);
  }
  view.innerHTML = `
    <div class="section-head"><h1>Matchs</h1><span class="hint">${matches.length} matchs · verrou T‑15 min · 🇨🇭 heure suisse</span></div>
    ${days.map(d => `
      <div class="daygroup-label">${esc(d.label)}</div>
      <div class="list">${d.items.map(matchCard).join('')}</div>
    `).join('')}`;
  bindMatchCards(view);
}

function matchCard(m) {
  const locked = m.locked;
  const finished = !!m.result;
  const ph = m.prediction ? m.prediction.home : '';
  const pa = m.prediction ? m.prediction.away : '';
  const stageLabel = m.stage === 'group' ? `Groupe ${m.group}` : STAGE_FR[m.stage];
  const isKO = m.stage !== 'group';
  const bothKnown = m.home.id != null && m.away.id != null;

  let foot = '';
  if (finished) {
    let pts = '';
    if (m.prediction && m.prediction.points != null) {
      pts = `<span class="pts ${m.prediction.points > 0 ? 'win' : 'zero'}">${m.prediction.points > 0 ? '+' : ''}${m.prediction.points} pt${m.prediction.points > 1 ? 's' : ''}</span>`;
    }
    foot = `<span class="result-pill">Résultat ${m.result.home} – ${m.result.away}</span>${pts}`;
  } else if (locked) {
    foot = `<span class="tag lock">🔒 Verrouillé · ${fmtTime(m.kickoff)}</span>`;
  } else if (m.prediction) {
    foot = `<span class="tag ok">✓ Prono enregistré · ${fmtTime(m.kickoff)}</span>`;
  } else {
    foot = `<span class="tag muted">À pronostiquer · ${fmtTime(m.kickoff)}</span>`;
  }
  // Once locked, predictions are frozen → everyone's picks become visible.
  if (locked || finished) foot += `<button class="linkish preds-btn" data-act="preds">👀 Pronos</button>`;

  const stepper = (sideKey, val) => `
    <div class="stepper">
      <button class="plus" data-act="inc" data-side="${sideKey}" aria-label="plus">+</button>
      <div class="val" data-val="${sideKey}">${val === '' ? '–' : val}</div>
      <button data-act="dec" data-side="${sideKey}" aria-label="moins">−</button>
    </div>`;

  let koPick = '';
  if (isKO && bothKnown && !finished) {
    const q = m.prediction?.qualifier;
    const qPts = m.stage === 'F' ? 5 : (m.stage === 'QF' || m.stage === 'SF' || m.stage === '3RD') ? 2 : 1;
    koPick = `
      <div class="ko-pick">
        <div class="label">${m.stage === 'F' ? 'Qui est champion du monde ?' : 'Qui se qualifie ?'} <span style="color:var(--gold)">+${qPts} pt${qPts > 1 ? 's' : ''}</span></div>
        <div class="pick-row">
          <div class="pick ${q === m.home.id ? 'sel' : ''}" data-act="qual" data-team="${m.home.id}">${flagImg(m.home, 'pickflag')}${esc(m.home.name)}</div>
          <div class="pick ${q === m.away.id ? 'sel' : ''}" data-act="qual" data-team="${m.away.id}">${flagImg(m.away, 'pickflag')}${esc(m.away.name)}</div>
        </div>
      </div>`;
  }

  return `
    <div class="match ${locked || finished ? 'locked' : ''}" data-id="${m.id}" data-ko="${isKO ? 1 : 0}">
      <div class="meta"><span class="stage">${esc(stageLabel)}</span><span>${m.ground ? esc(m.ground) : ''}</span></div>
      <div class="row">
        <div class="team">${flagImg(m.home)}<div class="name ${m.home.id ? '' : 'small'}">${esc(m.home.name)}</div></div>
        <div class="scorebox">
          ${stepper('home', ph)}
          <div class="scoresep">:</div>
          ${stepper('away', pa)}
        </div>
        <div class="team">${flagImg(m.away)}<div class="name ${m.away.id ? '' : 'small'}">${esc(m.away.name)}</div></div>
      </div>
      ${koPick}
      <div class="foot">${foot}</div>
      <div class="others" hidden></div>
    </div>`;
}

function bindMatchCards(view) {
  view.addEventListener('click', (e) => {
    const card = e.target.closest('.match');
    if (!card) return;
    const id = Number(card.dataset.id);
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    // Works on locked cards too — that's precisely when picks become public.
    if (act === 'preds') return togglePredictions(card, id);
    if (card.classList.contains('locked')) return;

    if (act === 'inc' || act === 'dec') {
      const side = btn.dataset.side;
      const valEl = card.querySelector(`[data-val="${side}"]`);
      let v = valEl.textContent === '–' ? 0 : parseInt(valEl.textContent, 10);
      v = act === 'inc' ? Math.min(v + 1, 30) : Math.max(v - 1, 0);
      valEl.textContent = v;
      queueMatchSave(card, id);
    } else if (act === 'qual') {
      card.querySelectorAll('.pick').forEach(p => p.classList.toggle('sel', p === btn));
      queueMatchSave(card, id);
    }
  });
}

async function togglePredictions(card, id) {
  const box = card.querySelector('.others');
  if (!box.hidden) { box.hidden = true; return; }
  if (!box.dataset.loaded) {
    try {
      const { predictions } = await api(`/api/matches/${id}/predictions`);
      box.innerHTML = predictions.length ? predictions.map(p => `
        <div class="other-row${p.me ? ' me' : ''}">
          <span class="op">${esc(p.pseudo)}</span>
          <span class="os">${p.home} – ${p.away}</span>
          ${p.qualifier ? `<span class="oq">→ ${esc(p.qualifier.name)}</span>` : ''}
          ${p.points != null ? `<span class="pts ${p.points > 0 ? 'win' : 'zero'}">${p.points > 0 ? '+' : ''}${p.points}</span>` : ''}
        </div>`).join('') : '<div class="other-row none">Personne n\'a pronostiqué ce match.</div>';
      box.dataset.loaded = '1';
    } catch (err) { return toast(err.message, 'err'); }
  }
  box.hidden = false;
}

function queueMatchSave(card, id) {
  const home = card.querySelector('[data-val="home"]').textContent;
  const away = card.querySelector('[data-val="away"]').textContent;
  if (home === '–' || away === '–') return; // need both sides
  const sel = card.querySelector('.pick.sel');
  const qualifier = sel ? Number(sel.dataset.team) : undefined;
  debounceSave('m' + id, async () => {
    try {
      await api(`/api/matches/${id}/prediction`, { method: 'PUT', body: { home: Number(home), away: Number(away), qualifier } });
      const foot = card.querySelector('.foot');
      if (foot && !card.querySelector('.result-pill')) foot.innerHTML = `<span class="tag ok">✓ Enregistré</span>`;
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ============================================================
// GROUPS
// ============================================================
async function viewGroups(view) {
  const { groups } = await api('/api/groups');
  view.innerHTML = `
    <div class="section-head"><h1>Groupes</h1><span class="hint">classement réel + ton pronostic</span></div>
    <div class="note">📊 Classement réel à gauche (mis à jour avec les résultats). Plus bas, ordonne les 4 équipes : <b>+1 pt par équipe à la bonne place finale</b>. Verrou au 1er match du groupe.</div>
    ${groups.map(groupCard).join('')}`;
  bindGroups(view, groups);
}

function groupCard(g) {
  const official = g.official_order;
  const pred = g.prediction?.order || g.teams.map(t => t.id);
  const teamById = Object.fromEntries(g.teams.map(t => [t.id, t]));
  const orderTeams = pred.map(id => teamById[id]).filter(Boolean);
  // pad with any missing teams
  for (const t of g.teams) if (!orderTeams.find(x => x.id === t.id)) orderTeams.push(t);

  const standRows = g.standings.length
    ? g.standings.map(s => `
        <tr class="${s.rank <= 2 ? 'qualif' : ''}">
          <td class="rk">${s.rank}</td>
          <td class="tn"><img src="${flagUrl(s.flag)}" alt=""/>${esc(s.name)}</td>
          <td>${s.played}</td><td>${s.gd > 0 ? '+' : ''}${s.gd}</td><td class="pts-col">${s.points}</td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="color:var(--ink-faint);padding:14px">Aucun match joué.</td></tr>`;

  return `
    <div class="group-card" data-letter="${g.letter}">
      <h2>Groupe ${g.letter} <span class="lk ${g.locked ? 'shut' : 'open'}">${g.locked ? '🔒 verrouillé' : '✎ ouvert'}</span></h2>
      <table class="tbl">
        <thead><tr><th>#</th><th style="text-align:left">Équipe</th><th>J</th><th>Diff</th><th>Pts</th></tr></thead>
        <tbody>${standRows}</tbody>
      </table>
      <div class="subhead">Ton pronostic d'ordre final</div>
      <ul class="order-list ${g.locked ? 'locked' : ''}" data-letter="${g.letter}">
        ${orderTeams.map((t, i) => orderItem(t, i, official, g.locked)).join('')}
      </ul>
    </div>`;
}

function orderItem(t, i, official, locked) {
  let badge = '';
  if (official) {
    const correct = official[i] === t.id;
    badge = correct ? `<span class="ok">✓ +1</span>` : `<span class="miss">✗</span>`;
  }
  const handle = locked ? '' : `<button class="drag-handle" aria-label="Glisser pour classer" title="Glisser pour classer">⠿</button>`;
  return `
    <li class="order-item ${locked ? '' : 'draggable'}" data-team="${t.id}">
      <span class="rk">${i + 1}</span>
      <img src="${flagUrl(t.flag)}" alt=""/>
      <span class="nm">${esc(t.name)}</span>
      ${badge}${handle}
    </li>`;
}

function bindGroups(view) {
  view.querySelectorAll('.order-list:not(.locked)').forEach(enableDragReorder);
}

// Touch + mouse drag-to-reorder via Pointer Events (no native HTML5 DnD — it doesn't work on mobile).
function enableDragReorder(list) {
  const letter = list.dataset.letter;
  let drag = null;

  const onMove = (e) => {
    if (!drag) return;
    e.preventDefault();
    // measure true flow position with the transform cleared, reorder, then offset under finger
    drag.li.style.transform = 'none';
    const others = [...list.querySelectorAll('.order-item:not(.dragging)')];
    let ref = null;
    for (const s of others) {
      const r = s.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { ref = s; break; }
    }
    list.insertBefore(drag.li, ref);
    [...list.children].forEach((x, i) => { x.querySelector('.rk').textContent = i + 1; });
    const slotTop = drag.li.getBoundingClientRect().top;
    drag.li.style.transform = `translateY(${(e.clientY - drag.offsetY) - slotTop}px) scale(1.02)`;
  };

  const onUp = (e) => {
    if (!drag) return;
    const { li, handle } = drag;
    handle.removeEventListener('pointermove', onMove);
    try { handle.releasePointerCapture(e.pointerId); } catch {}
    li.classList.remove('dragging');
    li.style.transform = '';
    li.style.zIndex = '';
    drag = null;
    const order = [...list.children].map(x => Number(x.dataset.team));
    debounceSave('g' + letter, async () => {
      try { await api(`/api/groups/${letter}/order`, { method: 'PUT', body: { order } }); toast(`Groupe ${letter} enregistré`); }
      catch (err) { toast(err.message, 'err'); }
    }, 400);
  };

  list.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const li = handle.closest('.order-item');
      const rect = li.getBoundingClientRect();
      drag = { li, handle, offsetY: e.clientY - rect.top };
      li.classList.add('dragging');
      li.style.zIndex = '50';
      try { handle.setPointerCapture(e.pointerId); } catch {}
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp, { once: true });
      handle.addEventListener('pointercancel', onUp, { once: true });
    });
  });
}

// ============================================================
// LEADERBOARD
// ============================================================
async function viewLeaderboard(view) {
  const { ranking, me } = await api('/api/leaderboard');
  const top3 = ranking.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const podiumOrder = [1, 0, 2]; // visual: 2nd, 1st, 3rd
  view.innerHTML = `
    <div class="section-head"><h1>Classement</h1><span class="hint">${ranking.length} joueur${ranking.length > 1 ? 's' : ''}</span></div>
    ${top3.length >= 2 ? `<div class="podium">
      ${podiumOrder.filter(i => top3[i]).map(i => `
        <div class="pod p${i + 1}">
          <div class="medal">${medals[i]}</div>
          <div class="nm">${esc(top3[i].pseudo)}</div>
          <div class="sc">${top3[i].points}</div>
        </div>`).join('')}
    </div>` : ''}
    <div class="rank-list">
      ${ranking.map(r => `
        <div class="rank-row ${r.user_id === me ? 'me' : ''}">
          <div class="pos">${r.rank}</div>
          <div class="who2">${esc(r.pseudo)}<small>${r.exact} score${r.exact > 1 ? 's' : ''} exact${r.exact > 1 ? 's' : ''} · ${r.scored} match${r.scored > 1 ? 's' : ''} joué${r.scored > 1 ? 's' : ''}</small></div>
          <div class="score">${r.points}</div>
        </div>`).join('')}
    </div>
    ${ranking.every(r => r.points === 0) ? '<div class="empty">Le classement se remplira dès les premiers résultats. ⚽</div>' : ''}`;
}

// ============================================================
// BONUS
// ============================================================
async function viewBonus(view) {
  const b = await api('/api/bonus');
  const teamOpts = b.teams.map(t => `<option value="${t.id}" ${b.winner?.team_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  const locked = b.locked;
  const wpts = b.winner?.points;
  const spts = b.top_scorer?.points;
  view.innerHTML = `
    <div class="section-head"><h1>Bonus</h1><span class="hint">10 pts chacun</span></div>
    <div class="note">⭐ Paris longue durée, ${locked ? '<b>verrouillés</b> (tournoi commencé).' : 'modifiables jusqu\'au coup d\'envoi du tournoi.'}</div>
    <div class="card-pad">
      <div class="field">
        <label>🏆 Vainqueur de la Coupe du Monde ${wpts != null ? `· <span style="color:var(--gold)">${wpts > 0 ? '+10 ✓' : 'raté'}</span>` : ''}</label>
        <select class="input" id="winnerSel" ${locked ? 'disabled' : ''}><option value="">— Choisir —</option>${teamOpts}</select>
      </div>
      <div class="field">
        <label>👟 Meilleur buteur ${spts != null ? `· <span style="color:var(--gold)">${spts > 0 ? '+10 ✓' : 'raté'}</span>` : ''}</label>
        <input class="input" id="scorerInp" placeholder="Nom du joueur" maxlength="60" value="${esc(b.top_scorer?.player_name || '')}" ${locked ? 'disabled' : ''} />
      </div>
      ${locked ? '' : '<button class="btn" id="saveBonus">Enregistrer mes bonus</button>'}
    </div>`;
  if (!locked) {
    view.querySelector('#saveBonus').addEventListener('click', async () => {
      const winner_team_id = view.querySelector('#winnerSel').value;
      const top_scorer = view.querySelector('#scorerInp').value.trim();
      try {
        await api('/api/bonus', { method: 'PUT', body: { ...(winner_team_id ? { winner_team_id: Number(winner_team_id) } : {}), top_scorer } });
        toast('Bonus enregistrés ⭐');
      } catch (err) { toast(err.message, 'err'); }
    });
  }
}

// ============================================================
// ADMIN
// ============================================================
async function viewAdmin(view) {
  const [{ matches, teams }, { groups }, bonus] = await Promise.all([
    api('/api/admin/matches'), api('/api/groups'), api('/api/admin/bonus'),
  ]);
  const teamOpt = (sel) => `<option value="">—</option>` + teams.map(t => `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

  const matchRow = (m) => {
    const isKO = m.stage !== 'group';
    const r = m.result || {};
    const teamSel = isKO && (m.home.id == null || m.away.id == null) ? `
      <div class="am-controls" style="margin-bottom:6px">
        <select class="input mini" data-f="home_team_id">${teamOpt(m.home.id)}</select>
        <span style="color:var(--ink-faint)">vs</span>
        <select class="input mini" data-f="away_team_id">${teamOpt(m.away.id)}</select>
        <button class="btn sm ghost" data-act="teams">Fixer équipes</button>
      </div>` : '';
    const advSel = isKO && m.home.id != null && m.away.id != null ? `
      <select class="input mini" data-f="advancing" title="qualifié">
        <option value="">qualifié?</option>
        <option value="${m.home.id}" ${r.advancing === m.home.id ? 'selected' : ''}>${esc(m.home.name)}</option>
        <option value="${m.away.id}" ${r.advancing === m.away.id ? 'selected' : ''}>${esc(m.away.name)}</option>
      </select>` : '';
    return `
      <div class="admin-match" data-id="${m.id}">
        <div class="am-head">
          ${flagImg(m.home, 'f')} <b>${esc(m.home.name)}</b> vs <b>${esc(m.away.name)}</b> ${flagImg(m.away, 'f')}
          <span style="color:var(--ink-faint);margin-left:auto">${m.stage === 'group' ? 'Gr.' + m.group : STAGE_FR[m.stage]}</span>
        </div>
        ${teamSel}
        <div class="am-controls">
          <input class="input mini" type="number" min="0" data-f="home_score" value="${r.home ?? ''}" />
          <span>:</span>
          <input class="input mini" type="number" min="0" data-f="away_score" value="${r.away ?? ''}" />
          ${advSel}
          <button class="btn sm" data-act="result">${m.result ? 'Modifier' : 'Valider'}</button>
          ${m.result ? `<span class="tag ok">✓ ${r.home}-${r.away}</span>` : ''}
        </div>
      </div>`;
  };

  const groupSetter = (g) => `
    <div class="admin-match" data-letter="${g.letter}">
      <div class="am-head"><b>Groupe ${g.letter}</b> — ordre officiel ${g.official_order ? '<span class="tag ok">figé ✓</span>' : ''}</div>
      <div style="font-size:12px;color:var(--ink-dim);margin-bottom:8px">Classement actuel : ${g.standings.map((s, i) => `${i + 1}.${esc(s.name)}`).join(' · ') || '—'}</div>
      <button class="btn sm" data-act="freeze">Figer cet ordre comme officiel</button>
      ${g.official_order ? '<button class="btn sm ghost" data-act="unfreeze">Annuler</button>' : ''}
    </div>`;

  view.innerHTML = `
   <div class="admin-wrap">
    <div class="section-head"><h1>Admin</h1><span class="hint">résultats & officiels</span></div>
    <div class="note">Saisis les scores finaux ici (filet de sécurité de l'auto-fetch). Pour les phases finales : fixe d'abord les équipes, puis le score et le qualifié.</div>

    <div class="subhead">🎖️ Issues du tournoi (bonus)</div>
    <div class="card-pad">
      <div class="field"><label>Vainqueur</label><select class="input" id="adWinner">${teamOpt(bonus.winner_team_id != null ? Number(bonus.winner_team_id) : undefined)}</select></div>
      <button class="btn" id="adOutcomes">Enregistrer le vainqueur</button>
      <div class="field" style="margin-top:14px">
        <label>Meilleur buteur — valide le pronostic de chacun (re-cliquer pour annuler)</label>
        ${bonus.scorers.length ? bonus.scorers.map(s => `
          <div class="am-controls" data-uid="${s.user_id}" data-validated="${s.admin_validated ?? ''}" style="margin-bottom:6px">
            <b style="min-width:90px">${esc(s.pseudo)}</b>
            <span style="flex:1">${esc(s.player_name)}</span>
            ${s.admin_validated === 1 ? '<span class="tag ok">+10</span>' : s.admin_validated === 0 ? '<span class="tag">0 pt</span>' : '<span class="tag muted">à valider</span>'}
            <button class="btn sm ${s.admin_validated === 1 ? '' : 'ghost'}" data-act="scorer-ok">✓</button>
            <button class="btn sm ${s.admin_validated === 0 ? '' : 'ghost'}" data-act="scorer-no">✗</button>
          </div>`).join('') : '<div style="font-size:13px;color:var(--ink-dim)">Aucun pronostic de buteur pour l\'instant.</div>'}
      </div>
    </div>

    <div class="subhead">📊 Ordre officiel des groupes</div>
    <div style="padding:0 14px">${groups.map(groupSetter).join('')}</div>

    <div class="subhead">⚽ Résultats des matchs</div>
    <div style="padding:0 14px 8px">${matches.map(matchRow).join('')}</div>
   </div>`;

  bindAdmin(view);
}

// Re-render the admin view in place WITHOUT resetting scroll position.
async function refreshAdmin() {
  const view = document.getElementById('view');
  if (!view) return;
  const y = window.scrollY;
  await viewAdmin(view);
  window.scrollTo(0, y);
}

function bindAdmin(view) {
  view.querySelector('#adOutcomes').addEventListener('click', async () => {
    const winner_team_id = view.querySelector('#adWinner').value;
    try { await api('/api/admin/outcomes', { method: 'PUT', body: { winner_team_id } }); toast('Vainqueur enregistré'); }
    catch (e) { toast(e.message, 'err'); }
  });

  // Delegate on the recreated .admin-wrap (not the persistent #view) so listeners
  // don't stack across in-place refreshes.
  view.querySelector('.admin-wrap').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === 'result' || act === 'teams') {
        const box = e.target.closest('.admin-match');
        const id = box.dataset.id;
        const get = (f) => { const el = box.querySelector(`[data-f="${f}"]`); return el ? el.value : undefined; };
        if (act === 'teams') {
          await api(`/api/admin/matches/${id}/teams`, { method: 'PUT', body: { home_team_id: get('home_team_id'), away_team_id: get('away_team_id') } });
          toast('Équipes fixées'); return refreshAdmin();
        }
        await api(`/api/admin/matches/${id}/result`, { method: 'PUT', body: { home_score: get('home_score'), away_score: get('away_score'), advancing_team_id: get('advancing') } });
        toast('Résultat enregistré'); refreshAdmin();
      } else if (act === 'scorer-ok' || act === 'scorer-no') {
        const row = e.target.closest('[data-uid]');
        const target = act === 'scorer-ok';
        const current = row.dataset.validated === '' ? null : row.dataset.validated === '1';
        // Clicking the already-active button resets the prediction to "pending".
        const validated = current === target ? null : target;
        await api(`/api/admin/bonus/top-scorer/${row.dataset.uid}`, { method: 'PUT', body: { validated } });
        toast(validated == null ? 'Validation annulée' : validated ? 'Buteur validé +10' : 'Buteur refusé');
        refreshAdmin();
      } else if (act === 'freeze' || act === 'unfreeze') {
        const box = e.target.closest('.admin-match');
        const letter = box.dataset.letter;
        if (act === 'unfreeze') { await api(`/api/admin/groups/${letter}/official-order`, { method: 'PUT', body: { order: null } }); }
        else {
          const { groups } = await api('/api/groups');
          const g = groups.find(x => x.letter === letter);
          const order = g.standings.map(s => s.team_id);
          if (order.length !== 4) return toast('Groupe incomplet (4 équipes requises).', 'err');
          await api(`/api/admin/groups/${letter}/official-order`, { method: 'PUT', body: { order } });
        }
        toast('Ordre officiel mis à jour'); refreshAdmin();
      }
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ============================================================
// ROUTER
// ============================================================
const VIEWS = { matches: viewMatches, groupes: viewGroups, classement: viewLeaderboard, bonus: viewBonus, admin: viewAdmin };

async function router() {
  if (!store.token || !store.user) return renderAuth();
  let route = currentRoute();
  if (!VIEWS[route]) route = 'matches';
  if (route === 'admin' && !store.user.is_admin) route = 'matches';
  const view = shell(route);
  try { await VIEWS[route](view); }
  catch (err) { view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}
function render() { router(); }

window.addEventListener('hashchange', router);

// boot: validate stored session
(async () => {
  if (store.token) {
    try { const r = await api('/api/auth/me'); store.user = r.user; } catch { store.token = null; store.user = null; }
  }
  router();
})();

import { db } from './db.js';
import { recomputeMatch } from './scoring.js';

// Primary live source: ESPN public scoreboard (no key, updated in real time).
// Fallback: the openfootball snapshot (community-maintained, often lags days behind).
const ESPN_URL = process.env.ESPN_URL
  || 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const FETCH_URL = process.env.FETCH_URL
  || 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

/** Extract a final score [home, away] from an openfootball match, or null. */
function remoteScore(m) {
  if (m.score && Array.isArray(m.score.ft) && m.score.ft.length === 2) return m.score.ft;
  if (Array.isArray(m.ft) && m.ft.length === 2) return m.ft;
  if (m.score1 != null && m.score2 != null) return [Number(m.score1), Number(m.score2)];
  return null;
}

// Sources disagree on some country names — map them onto our seed names
// (after normalization: lowercase, no diacritics, alphanumeric only).
const ALIAS = {
  czechia: 'czechrepublic',
  unitedstates: 'usa',
  cotedivoire: 'ivorycoast',
  turkiye: 'turkey',
  caboverde: 'capeverde',
  korearepublic: 'southkorea',
  congodr: 'drcongo',
  democraticrepublicofthecongo: 'drcongo',
  irrepofiran: 'iran',
};
const norm = (s) => {
  const n = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  return ALIAS[n] || n;
};

const dateStr = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Completed matches from ESPN over the last few days: { team1, team2, ft }. */
async function fetchEspnResults() {
  const now = new Date();
  const from = new Date(now.getTime() - 3 * 86_400_000);
  const url = `${ESPN_URL}?dates=${dateStr(from)}-${dateStr(now)}&limit=200`;
  const res = await fetch(url, { headers: { 'user-agent': 'pronostix' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.events || []).map(ev => {
    const c = ev.competitions?.[0];
    if (!c?.status?.type?.completed) return null;
    const home = c.competitors?.find(x => x.homeAway === 'home');
    const away = c.competitors?.find(x => x.homeAway === 'away');
    if (!home?.team || !away?.team) return null;
    return {
      team1: home.team.displayName,
      team2: away.team.displayName,
      ft: [Number(home.score), Number(away.score)],
    };
  }).filter(Boolean);
}

export async function fetchResultsOnce(log = console) {
  // Index local group matches by english team names (set at seed time).
  // Group pairings are unique across the group stage, so team names alone are
  // a safe key — and they avoid local-date vs UTC-date mismatches.
  const locals = db.prepare(`
    SELECT m.*, h.name_en AS home_en, a.name_en AS away_en
    FROM matches m
    LEFT JOIN teams h ON h.id = m.home_team_id
    LEFT JOIN teams a ON a.id = m.away_team_id
    WHERE m.stage = 'group'
  `).all();
  const key = (t1, t2) => `${norm(t1)}|${norm(t2)}`;
  const index = new Map(locals.map(m => [key(m.home_en, m.away_en), m]));

  let updated = 0;
  const errors = [];
  const apply = (team1, team2, ft) => {
    let local = index.get(key(team1, team2));
    let swapped = false;
    if (!local) { local = index.get(key(team2, team1)); swapped = true; }
    if (!local || local.status === 'finished') return; // never override admin/already scored
    const [h, a] = swapped ? [ft[1], ft[0]] : ft;
    db.prepare("UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE id = ?")
      .run(Number(h), Number(a), local.id);
    recomputeMatch(local.id);
    local.status = 'finished'; // guard against a second source re-applying
    updated++;
  };

  // 1) ESPN live scoreboard
  try {
    for (const ev of await fetchEspnResults()) apply(ev.team1, ev.team2, ev.ft);
  } catch (e) {
    errors.push(`espn: ${e.message}`);
    log.warn?.(`[fetcher] échec ESPN: ${e.message}`);
  }

  // 2) openfootball snapshot
  try {
    const res = await fetch(FETCH_URL, { headers: { 'user-agent': 'pronostix' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    for (const rm of (data.matches || [])) {
      if (!rm.group) continue;
      const sc = remoteScore(rm);
      if (sc) apply(rm.team1, rm.team2, sc);
    }
  } catch (e) {
    errors.push(`openfootball: ${e.message}`);
    log.warn?.(`[fetcher] échec openfootball: ${e.message}`);
  }

  if (updated) log.info?.(`[fetcher] ${updated} résultat(s) appliqué(s) automatiquement.`);
  return { updated, ...(errors.length ? { error: errors.join(' ; ') } : {}) };
}

export function startFetcher(log = console) {
  const min = Number(process.env.FETCH_INTERVAL_MIN || 0);
  if (!min || min <= 0) { log.info?.('[fetcher] désactivé (FETCH_INTERVAL_MIN=0)'); return; }
  log.info?.(`[fetcher] actif, intervalle ${min} min`);
  const tick = () => fetchResultsOnce(log).catch(e => log.warn?.(`[fetcher] ${e.message}`));
  setTimeout(tick, 10_000);                 // first run shortly after boot
  setInterval(tick, min * 60_000);
}

import { db } from './db.js';
import { recomputeMatch } from './scoring.js';

const FETCH_URL = process.env.FETCH_URL
  || 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

/** Extract a final score [home, away] from an openfootball match, or null. */
function remoteScore(m) {
  if (m.score && Array.isArray(m.score.ft) && m.score.ft.length === 2) return m.score.ft;
  if (Array.isArray(m.ft) && m.ft.length === 2) return m.ft;
  if (m.score1 != null && m.score2 != null) return [Number(m.score1), Number(m.score2)];
  return null;
}

const norm = (s) => String(s || '').trim().toLowerCase();

export async function fetchResultsOnce(log = console) {
  let data;
  try {
    const res = await fetch(FETCH_URL, { headers: { 'user-agent': 'pronostix' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    log.warn?.(`[fetcher] échec récupération: ${e.message}`);
    return { updated: 0, error: e.message };
  }

  // Index local group matches by date + english team names (set at seed time).
  const locals = db.prepare(`
    SELECT m.*, h.name_en AS home_en, a.name_en AS away_en
    FROM matches m
    LEFT JOIN teams h ON h.id = m.home_team_id
    LEFT JOIN teams a ON a.id = m.away_team_id
    WHERE m.stage = 'group'
  `).all();
  // Group pairings are unique across the group stage, so team names alone are a safe
  // key — and they avoid the local-date vs UTC-date mismatch for late kickoffs.
  const key = (t1, t2) => `${norm(t1)}|${norm(t2)}`;
  const index = new Map(locals.map(m => [key(m.home_en, m.away_en), m]));

  let updated = 0;
  for (const rm of (data.matches || [])) {
    if (!rm.group) continue;
    const sc = remoteScore(rm);
    if (!sc) continue;
    const local = index.get(key(rm.team1, rm.team2));
    if (!local || local.status === 'finished') continue; // never override admin/already scored
    db.prepare("UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE id = ?")
      .run(Number(sc[0]), Number(sc[1]), local.id);
    recomputeMatch(local.id);
    updated++;
  }
  if (updated) log.info?.(`[fetcher] ${updated} résultat(s) appliqué(s) automatiquement.`);
  return { updated };
}

export function startFetcher(log = console) {
  const min = Number(process.env.FETCH_INTERVAL_MIN || 0);
  if (!min || min <= 0) { log.info?.('[fetcher] désactivé (FETCH_INTERVAL_MIN=0)'); return; }
  log.info?.(`[fetcher] actif, intervalle ${min} min`);
  const tick = () => fetchResultsOnce(log).catch(e => log.warn?.(`[fetcher] ${e.message}`));
  setTimeout(tick, 10_000);                 // first run shortly after boot
  setInterval(tick, min * 60_000);
}

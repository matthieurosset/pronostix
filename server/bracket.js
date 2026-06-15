import { db } from './db.js';
import { groupStandings } from './standings.js';
import { recomputeMatch } from './scoring.js';

// A knockout slot label is "composite" when it denotes one of the best
// third-placed teams (e.g. "3A/B/C/D/F"). The exact group→slot allocation
// follows FIFA's official table and is left to the admin; everything else
// (group winner/runner-up, winner/loser of a match) is deterministic.
export const isComposite = (label) => /\//.test(String(label || ''));

/** True once every group-stage match of a group has a final score. */
function isGroupComplete(letter) {
  const row = db.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS done " +
    "FROM matches WHERE group_letter = ? AND stage = 'group'"
  ).get(letter);
  return row.total > 0 && row.done === row.total;
}

/** Map currently-known placeholder labels (1A, 2B, 3C, W74, L101) → team id. */
function buildLabelMap() {
  const map = new Map();

  // Group ranks — only for fully-played groups, so the order is final.
  const letters = db.prepare("SELECT DISTINCT group_letter FROM matches WHERE group_letter IS NOT NULL")
    .all().map(r => r.group_letter);
  for (const L of letters) {
    if (!isGroupComplete(L)) continue;
    const s = groupStandings(L);
    if (s[0]) map.set(`1${L}`, s[0].team_id);
    if (s[1]) map.set(`2${L}`, s[1].team_id);
    if (s[2]) map.set(`3${L}`, s[2].team_id); // for candidate hints, never auto-placed
  }

  // Winner / loser of finished knockout matches (needs both teams resolved).
  const ko = db.prepare("SELECT * FROM matches WHERE stage != 'group' AND num IS NOT NULL").all();
  for (const m of ko) {
    if (m.status === 'finished' && m.advancing_team_id != null
        && m.home_team_id != null && m.away_team_id != null) {
      map.set(`W${m.num}`, m.advancing_team_id);
      map.set(`L${m.num}`, m.advancing_team_id === m.home_team_id ? m.away_team_id : m.home_team_id);
    }
  }
  return map;
}

const koMatches = () => db.prepare("SELECT * FROM matches WHERE stage != 'group' ORDER BY num").all();

/**
 * Fill every resolvable knockout slot from current results, cascading
 * R32 → R16 → QF → SF → Final. Only ever fills empty slots (never overrides an
 * admin-set team) and skips composite "best third" labels. Idempotent.
 */
export function resolveBracket() {
  const filled = [];
  let changed = true;
  while (changed) {
    changed = false;
    const map = buildLabelMap();
    for (const m of koMatches()) {
      const sides = [
        ['home_team_id', m.home_team_id, m.home_label],
        ['away_team_id', m.away_team_id, m.away_label],
      ];
      for (const [col, teamId, label] of sides) {
        if (teamId != null || !label || isComposite(label)) continue;
        const resolved = map.get(label);
        if (resolved == null) continue;
        db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(resolved, m.id);
        if (m.status === 'finished') recomputeMatch(m.id);
        filled.push({ match: m.num ?? m.id, slot: col === 'home_team_id' ? 1 : 2, label });
        changed = true;
      }
    }
  }
  return { filled, ...bracketStatus() };
}

/** Unresolved knockout slots, with candidate thirds for composite labels. */
export function bracketStatus() {
  const map = buildLabelMap();
  const pending = [];
  for (const m of koMatches()) {
    for (const [col, teamId, label] of [
      ['home_team_id', m.home_team_id, m.home_label],
      ['away_team_id', m.away_team_id, m.away_label],
    ]) {
      if (teamId != null || !label) continue;
      const composite = isComposite(label);
      let candidates = null;
      if (composite) {
        // label like "3A/B/C/D/F" → eligible groups whose third is already known
        const groups = label.slice(1).split('/');
        candidates = groups
          .map(g => ({ group: g, team_id: map.get(`3${g}`) ?? null }))
          .filter(c => c.team_id != null);
      }
      pending.push({
        match_id: m.id, num: m.num ?? null, stage: m.stage,
        slot: col === 'home_team_id' ? 1 : 2, label, composite, candidates,
      });
    }
  }
  return { pending };
}

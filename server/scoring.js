import { db, getSetting } from './db.js';

export const POINTS = {
  EXACT: 3,
  RESULT: 1,
  QUALIFIER: 1,    // KO: correct advancing team (flat, every round)
  GROUP_SLOT: 1,   // per team placed in the correct final group position
  BONUS: 10,       // tournament winner / top scorer
  RISK_POOL: 2,    // KO: shared "contrarian" pool for minority qualifier pickers
};

/**
 * Risk rule: among everyone who picked a qualifier for a KO match, the team
 * backed by a STRICT minority is the contrarian bet. If it advances, its
 * backers split RISK_POOL (e.g. alone → 2 pts, 2 of 5 → 1 pt each). A tie or a
 * majority earns nothing. Returns { teamId, count } of that minority team, or null.
 */
export function minorityPick(picks) {
  if (!picks.length) return null;
  const tally = new Map();
  for (const id of picks) tally.set(id, (tally.get(id) || 0) + 1);
  let best = null;
  for (const [teamId, count] of tally) {
    if (count < picks.length / 2 && (!best || count < best.count)) best = { teamId, count };
  }
  return best;
}

/** Core match scoring: 3 exact, 1 correct outcome, 0 otherwise. */
export function scoreMatch(pHome, pAway, aHome, aAway) {
  if (pHome === aHome && pAway === aAway) return POINTS.EXACT;
  return Math.sign(pHome - pAway) === Math.sign(aHome - aAway) ? POINTS.RESULT : 0;
}

/** Recompute every prediction's points for one match. */
export function recomputeMatch(matchId) {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!m) return;
  const finished = m.status === 'finished' && m.home_score != null && m.away_score != null;
  const preds = db.prepare('SELECT * FROM predictions WHERE match_id = ?').all(matchId);

  // Risk bonus: if the team that actually advanced was the minority qualifier pick,
  // its backers split RISK_POOL (count = how many backed it).
  let riskTeam = null;
  if (finished && m.stage !== 'group' && m.advancing_team_id != null) {
    const picks = preds.filter(p => p.qualifier_team_id != null).map(p => p.qualifier_team_id);
    const minority = minorityPick(picks);
    if (minority && minority.teamId === m.advancing_team_id) riskTeam = minority;
  }

  const upd = db.prepare('UPDATE predictions SET points = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const p of preds) {
      if (!finished) { upd.run(null, p.id); continue; }
      let pts = scoreMatch(p.home_score, p.away_score, m.home_score, m.away_score);
      if (m.stage !== 'group' && m.advancing_team_id != null && p.qualifier_team_id != null
          && p.qualifier_team_id === m.advancing_team_id) {
        pts += POINTS.QUALIFIER;
        if (riskTeam) pts += POINTS.RISK_POOL / riskTeam.count;
      }
      upd.run(pts, p.id);
    }
  });
  tx();
}

/** Official final order of a group, stored by the admin as a JSON array of team ids. */
export function getOfficialGroupOrder(letter) {
  const raw = getSetting(`group_order_${letter}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Recompute group-order prediction points for one group (1 pt per correct slot). */
export function recomputeGroupOrder(letter) {
  const official = getOfficialGroupOrder(letter);
  const preds = db.prepare('SELECT * FROM group_order_predictions WHERE group_letter = ?').all(letter);
  const upd = db.prepare('UPDATE group_order_predictions SET points = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const p of preds) {
      if (!official) { upd.run(null, p.id); continue; }
      let order;
      try { order = JSON.parse(p.order_json); } catch { order = []; }
      let pts = 0;
      for (let i = 0; i < official.length; i++) {
        if (order[i] != null && order[i] === official[i]) pts += POINTS.GROUP_SLOT;
      }
      upd.run(pts, p.id);
    }
  });
  tx();
}

export function recomputeAllGroupOrders() {
  const letters = db.prepare('SELECT DISTINCT group_letter FROM matches WHERE group_letter IS NOT NULL')
    .all().map(r => r.group_letter);
  for (const l of letters) recomputeGroupOrder(l);
}

/** Recompute bonus points: winner from the official outcome (team id),
 *  top scorer from the admin's per-prediction validation (admin_validated). */
export function recomputeBonus() {
  const winnerTeamId = getSetting('winner_team_id');
  const preds = db.prepare('SELECT * FROM bonus_predictions').all();
  const upd = db.prepare('UPDATE bonus_predictions SET points = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const p of preds) {
      let pts = null;
      if (p.type === 'winner' && winnerTeamId) {
        pts = String(p.team_id) === String(winnerTeamId) ? POINTS.BONUS : 0;
      } else if (p.type === 'top_scorer' && p.admin_validated != null) {
        pts = p.admin_validated ? POINTS.BONUS : 0;
      }
      upd.run(pts, p.id);
    }
  });
  tx();
}

/**
 * Family leaderboard with a per-user points breakdown:
 * group-stage matches, group order, knockout matches, and bonus.
 */
export function leaderboard() {
  const rows = db.prepare(`
    SELECT u.id, u.pseudo,
      COALESCE((SELECT SUM(p.points) FROM predictions p JOIN matches m ON m.id = p.match_id
                WHERE p.user_id = u.id AND m.stage =  'group'), 0) AS group_points,
      COALESCE((SELECT SUM(points) FROM group_order_predictions WHERE user_id = u.id), 0) AS order_points,
      COALESCE((SELECT SUM(p.points) FROM predictions p JOIN matches m ON m.id = p.match_id
                WHERE p.user_id = u.id AND m.stage != 'group'), 0) AS ko_points,
      COALESCE((SELECT SUM(points) FROM bonus_predictions WHERE user_id = u.id), 0) AS bonus_points,
      (SELECT COUNT(*) FROM predictions WHERE user_id = u.id AND points = ${POINTS.EXACT}) AS exact_count,
      (SELECT COUNT(*) FROM predictions WHERE user_id = u.id AND points IS NOT NULL)       AS scored_count
    FROM users u
  `).all();
  for (const r of rows) {
    r.points = r.group_points + r.order_points + r.ko_points + r.bonus_points;
  }
  rows.sort((a, b) =>
    b.points - a.points || b.exact_count - a.exact_count || a.pseudo.localeCompare(b.pseudo));
  return rows;
}

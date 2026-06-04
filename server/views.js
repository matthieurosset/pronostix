import { db } from './db.js';
import { isMatchLocked } from './locks.js';

const teamStmt = db.prepare('SELECT id, name_fr, flag, fifa_code, group_letter FROM teams WHERE id = ?');

export function teamLite(id) {
  if (id == null) return null;
  const t = teamStmt.get(id);
  return t ? { id: t.id, name: t.name_fr, flag: t.flag, code: t.fifa_code, group: t.group_letter } : null;
}

/** A match side is either a known team or a placeholder label ("1A", "W74"). */
export function sideView(teamId, label) {
  const t = teamLite(teamId);
  if (t) return t;
  return { id: null, name: label || 'À déterminer', flag: null, code: null, placeholder: label || '?' };
}

export function matchView(m, pred) {
  return {
    id: m.id,
    stage: m.stage,
    group: m.group_letter,
    matchday: m.matchday,
    kickoff: m.kickoff_utc,
    ground: m.ground,
    home: sideView(m.home_team_id, m.home_label),
    away: sideView(m.away_team_id, m.away_label),
    status: m.status,
    locked: isMatchLocked(m),
    result: (m.home_score != null && m.away_score != null)
      ? { home: m.home_score, away: m.away_score, advancing: m.advancing_team_id }
      : null,
    prediction: pred
      ? { home: pred.home_score, away: pred.away_score, qualifier: pred.qualifier_team_id, points: pred.points }
      : null,
  };
}

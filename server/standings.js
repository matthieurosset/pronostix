import { db } from './db.js';

/**
 * Live standings of a group computed from finished group matches.
 * Tiebreakers (FIFA-style approximation): points, goal difference, goals for,
 * then head-to-head points / GD among the tied teams, then name.
 */
export function groupStandings(letter) {
  const teams = db.prepare('SELECT * FROM teams WHERE group_letter = ? ORDER BY name_fr').all(letter);
  const matches = db.prepare(
    "SELECT * FROM matches WHERE group_letter = ? AND stage = 'group' AND status = 'finished' AND home_score IS NOT NULL"
  ).all(letter);

  const stat = new Map();
  for (const t of teams) {
    stat.set(t.id, { team: t, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 });
  }

  const apply = (id, gf, ga) => {
    const s = stat.get(id);
    if (!s) return;
    s.played++; s.gf += gf; s.ga += ga; s.gd = s.gf - s.ga;
    if (gf > ga) { s.won++; s.points += 3; }
    else if (gf === ga) { s.drawn++; s.points += 1; }
    else s.lost++;
  };

  for (const m of matches) {
    if (m.home_team_id == null || m.away_team_id == null) continue;
    apply(m.home_team_id, m.home_score, m.away_score);
    apply(m.away_team_id, m.away_score, m.home_score);
  }

  // head-to-head helpers among a tied subset
  const h2h = (ids) => {
    const sub = new Map(ids.map(id => [id, { points: 0, gd: 0 }]));
    for (const m of matches) {
      if (!sub.has(m.home_team_id) || !sub.has(m.away_team_id)) continue;
      const a = sub.get(m.home_team_id), b = sub.get(m.away_team_id);
      a.gd += m.home_score - m.away_score; b.gd += m.away_score - m.home_score;
      if (m.home_score > m.away_score) a.points += 3;
      else if (m.home_score === m.away_score) { a.points += 1; b.points += 1; }
      else b.points += 3;
    }
    return sub;
  };

  const rows = [...stat.values()].sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    const sub = h2h([x.team.id, y.team.id]);
    const hx = sub.get(x.team.id), hy = sub.get(y.team.id);
    if (hy.points !== hx.points) return hy.points - hx.points;
    if (hy.gd !== hx.gd) return hy.gd - hx.gd;
    return x.team.name_fr.localeCompare(y.team.name_fr);
  });

  return rows.map((s, i) => ({
    rank: i + 1,
    team_id: s.team.id,
    name: s.team.name_fr,
    flag: s.team.flag,
    played: s.played, won: s.won, drawn: s.drawn, lost: s.lost,
    gf: s.gf, ga: s.ga, gd: s.gd, points: s.points,
  }));
}

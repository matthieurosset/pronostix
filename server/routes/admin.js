import { db, setSetting, getSetting } from '../db.js';
import { requireAdmin } from '../auth.js';
import { matchView, teamLite } from '../views.js';
import { recomputeMatch, recomputeGroupOrder, recomputeBonus } from '../scoring.js';

export default async function adminRoutes(app) {
  // Full match list (raw) + team catalogue for the admin selectors.
  app.get('/api/admin/matches', { preHandler: requireAdmin }, async () => {
    const matches = db.prepare('SELECT * FROM matches ORDER BY kickoff_utc, id').all();
    const teams = db.prepare('SELECT id FROM teams ORDER BY name_fr').all().map(t => teamLite(t.id));
    return { matches: matches.map(m => matchView(m, null)), teams };
  });

  // Enter / correct a final result. Empty scores reset the match to scheduled.
  app.put('/api/admin/matches/:id/result', { preHandler: requireAdmin }, async (req, reply) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
    if (!match) return reply.code(404).send({ error: 'Match introuvable' });

    const clear = req.body?.home_score == null || req.body?.away_score === '' || req.body?.home_score === '';
    if (clear) {
      db.prepare("UPDATE matches SET home_score = NULL, away_score = NULL, advancing_team_id = NULL, status = 'scheduled' WHERE id = ?")
        .run(match.id);
      recomputeMatch(match.id);
      return { ok: true, match: matchView(db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id), null) };
    }

    const home = Number(req.body.home_score);
    const away = Number(req.body.away_score);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
      return reply.code(400).send({ error: 'Score invalide.' });
    }

    let advancing = null;
    if (match.stage !== 'group') {
      const a = req.body?.advancing_team_id;
      if (a != null && a !== '') {
        const aid = Number(a);
        if (aid !== match.home_team_id && aid !== match.away_team_id) {
          return reply.code(400).send({ error: 'Le qualifié doit être une des deux équipes.' });
        }
        advancing = aid;
      }
    }

    db.prepare("UPDATE matches SET home_score = ?, away_score = ?, advancing_team_id = ?, status = 'finished' WHERE id = ?")
      .run(home, away, advancing, match.id);
    recomputeMatch(match.id);
    return { ok: true, match: matchView(db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id), null) };
  });

  // Resolve a knockout match's teams once they are known.
  app.put('/api/admin/matches/:id/teams', { preHandler: requireAdmin }, async (req, reply) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
    if (!match) return reply.code(404).send({ error: 'Match introuvable' });

    const resolve = (v) => {
      if (v == null || v === '') return null;
      const id = Number(v);
      return db.prepare('SELECT 1 FROM teams WHERE id = ?').get(id) ? id : undefined;
    };
    const home = resolve(req.body?.home_team_id);
    const away = resolve(req.body?.away_team_id);
    if (home === undefined || away === undefined) return reply.code(400).send({ error: 'Équipe inconnue.' });

    db.prepare('UPDATE matches SET home_team_id = ?, away_team_id = ? WHERE id = ?')
      .run(home ?? match.home_team_id, away ?? match.away_team_id, match.id);
    if (match.status === 'finished') recomputeMatch(match.id);
    return { ok: true, match: matchView(db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id), null) };
  });

  // Freeze the official final order of a group → awards group-order points.
  app.put('/api/admin/groups/:letter/official-order', { preHandler: requireAdmin }, async (req, reply) => {
    const letter = String(req.params.letter).toUpperCase();
    const teamIds = db.prepare('SELECT id FROM teams WHERE group_letter = ?').all(letter).map(r => r.id);
    if (teamIds.length === 0) return reply.code(404).send({ error: 'Groupe inconnu' });

    if (req.body?.order == null) {  // clear
      setSetting(`group_order_${letter}`, null);
      recomputeGroupOrder(letter);
      return { ok: true };
    }
    const order = Array.isArray(req.body.order) ? req.body.order.map(Number) : [];
    const valid = order.length === teamIds.length && new Set(order).size === order.length
      && order.every(id => teamIds.includes(id));
    if (!valid) return reply.code(400).send({ error: 'Ordre officiel invalide.' });

    setSetting(`group_order_${letter}`, JSON.stringify(order));
    recomputeGroupOrder(letter);
    return { ok: true };
  });

  // Set the tournament winner → awards winner bonus points.
  app.put('/api/admin/outcomes', { preHandler: requireAdmin }, async (req, reply) => {
    if ('winner_team_id' in (req.body || {})) {
      const v = req.body.winner_team_id;
      if (v == null || v === '') setSetting('winner_team_id', null);
      else {
        const tid = Number(v);
        if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(tid)) return reply.code(400).send({ error: 'Équipe inconnue.' });
        setSetting('winner_team_id', tid);
      }
    }
    recomputeBonus();
    return { ok: true, winner_team_id: getSetting('winner_team_id') };
  });

  // Bonus overview: current winner + every top-scorer prediction awaiting validation.
  app.get('/api/admin/bonus', { preHandler: requireAdmin }, async () => {
    const scorers = db.prepare(`
      SELECT b.user_id, u.pseudo, b.player_name, b.admin_validated
      FROM bonus_predictions b JOIN users u ON u.id = b.user_id
      WHERE b.type = 'top_scorer' AND COALESCE(TRIM(b.player_name), '') != ''
      ORDER BY u.pseudo COLLATE NOCASE
    `).all();
    return { winner_team_id: getSetting('winner_team_id'), scorers };
  });

  // Validate one user's top-scorer prediction: true → +10, false → 0, null → pending.
  app.put('/api/admin/bonus/top-scorer/:userId', { preHandler: requireAdmin }, async (req, reply) => {
    const v = req.body?.validated;
    const val = v == null ? null : (v ? 1 : 0);
    const r = db.prepare("UPDATE bonus_predictions SET admin_validated = ? WHERE user_id = ? AND type = 'top_scorer'")
      .run(val, Number(req.params.userId));
    if (r.changes === 0) return reply.code(404).send({ error: 'Pronostic introuvable.' });
    recomputeBonus();
    return { ok: true };
  });
}

import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { isMatchLocked } from '../locks.js';
import { matchView } from '../views.js';
import { recomputeMatch } from '../scoring.js';

export default async function matchRoutes(app) {
  // All matches with the current user's predictions, sorted by kickoff.
  app.get('/api/matches', { preHandler: requireAuth }, async (req) => {
    const matches = db.prepare('SELECT * FROM matches ORDER BY kickoff_utc, id').all();
    const preds = db.prepare('SELECT * FROM predictions WHERE user_id = ?').all(req.user.id);
    const byMatch = new Map(preds.map(p => [p.match_id, p]));
    return { matches: matches.map(m => matchView(m, byMatch.get(m.id))) };
  });

  // Create / update a prediction. Rejected once the match is locked (T-15 min).
  app.put('/api/matches/:id/prediction', { preHandler: requireAuth }, async (req, reply) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
    if (!match) return reply.code(404).send({ error: 'Match introuvable' });
    if (isMatchLocked(match)) return reply.code(409).send({ error: 'Match verrouillé (coup d’envoi imminent).' });

    const home = Number(req.body?.home);
    const away = Number(req.body?.away);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 30 || away > 30) {
      return reply.code(400).send({ error: 'Score invalide.' });
    }

    let qualifier = null;
    if (match.stage !== 'group') {
      const q = req.body?.qualifier;
      if (q != null) {
        const qid = Number(q);
        if (qid !== match.home_team_id && qid !== match.away_team_id) {
          return reply.code(400).send({ error: 'Le qualifié doit être une des deux équipes.' });
        }
        qualifier = qid;
      }
    }

    db.prepare(`
      INSERT INTO predictions(user_id, match_id, home_score, away_score, qualifier_team_id, updated_at)
      VALUES(@uid, @mid, @home, @away, @qual, @now)
      ON CONFLICT(user_id, match_id) DO UPDATE SET
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        qualifier_team_id = excluded.qualifier_team_id,
        updated_at = excluded.updated_at
    `).run({ uid: req.user.id, mid: match.id, home, away, qual: qualifier, now: new Date().toISOString() });

    if (match.status === 'finished') recomputeMatch(match.id);

    const pred = db.prepare('SELECT * FROM predictions WHERE user_id = ? AND match_id = ?').get(req.user.id, match.id);
    return { ok: true, match: matchView(match, pred) };
  });
}

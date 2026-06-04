import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { isBonusLocked } from '../locks.js';
import { teamLite } from '../views.js';
import { recomputeBonus } from '../scoring.js';

export default async function bonusRoutes(app) {
  app.get('/api/bonus', { preHandler: requireAuth }, async (req) => {
    const rows = db.prepare('SELECT * FROM bonus_predictions WHERE user_id = ?').all(req.user.id);
    const winner = rows.find(r => r.type === 'winner');
    const scorer = rows.find(r => r.type === 'top_scorer');
    const teams = db.prepare('SELECT id FROM teams ORDER BY name_fr').all().map(t => teamLite(t.id));
    return {
      locked: isBonusLocked(),
      teams,
      winner: winner ? { team_id: winner.team_id, points: winner.points } : null,
      top_scorer: scorer ? { player_name: scorer.player_name, points: scorer.points } : null,
    };
  });

  app.put('/api/bonus', { preHandler: requireAuth }, async (req, reply) => {
    if (isBonusLocked()) return reply.code(409).send({ error: 'Bonus verrouillés (tournoi commencé).' });
    const now = new Date().toISOString();

    if ('winner_team_id' in (req.body || {})) {
      const tid = Number(req.body.winner_team_id);
      const exists = db.prepare('SELECT 1 FROM teams WHERE id = ?').get(tid);
      if (!exists) return reply.code(400).send({ error: 'Équipe inconnue.' });
      db.prepare(`
        INSERT INTO bonus_predictions(user_id, type, team_id, updated_at)
        VALUES(?, 'winner', ?, ?)
        ON CONFLICT(user_id, type) DO UPDATE SET team_id = excluded.team_id, updated_at = excluded.updated_at
      `).run(req.user.id, tid, now);
    }

    if ('top_scorer' in (req.body || {})) {
      const name = String(req.body.top_scorer || '').trim().slice(0, 60);
      db.prepare(`
        INSERT INTO bonus_predictions(user_id, type, player_name, updated_at)
        VALUES(?, 'top_scorer', ?, ?)
        ON CONFLICT(user_id, type) DO UPDATE SET player_name = excluded.player_name, updated_at = excluded.updated_at
      `).run(req.user.id, name, now);
    }

    recomputeBonus();
    return { ok: true };
  });
}

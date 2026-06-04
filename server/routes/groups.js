import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { isGroupOrderLocked, groupFirstKickoffMs } from '../locks.js';
import { groupStandings } from '../standings.js';
import { teamLite } from '../views.js';
import { getOfficialGroupOrder, recomputeGroupOrder } from '../scoring.js';

function groupLetters() {
  return db.prepare(
    "SELECT DISTINCT group_letter AS l FROM matches WHERE group_letter IS NOT NULL ORDER BY group_letter"
  ).all().map(r => r.l);
}

export default async function groupRoutes(app) {
  app.get('/api/groups', { preHandler: requireAuth }, async (req) => {
    const orders = db.prepare('SELECT * FROM group_order_predictions WHERE user_id = ?').all(req.user.id);
    const byLetter = new Map(orders.map(o => [o.group_letter, o]));

    const groups = groupLetters().map(letter => {
      const teams = db.prepare('SELECT * FROM teams WHERE group_letter = ? ORDER BY name_fr').all(letter)
        .map(t => teamLite(t.id));
      const pred = byLetter.get(letter);
      return {
        letter,
        teams,
        standings: groupStandings(letter),
        official_order: getOfficialGroupOrder(letter),
        locked: isGroupOrderLocked(letter),
        first_kickoff: new Date(groupFirstKickoffMs(letter)).toISOString(),
        prediction: pred
          ? { order: JSON.parse(pred.order_json), points: pred.points }
          : null,
      };
    });
    return { groups };
  });

  app.put('/api/groups/:letter/order', { preHandler: requireAuth }, async (req, reply) => {
    const letter = String(req.params.letter).toUpperCase();
    if (isGroupOrderLocked(letter)) {
      return reply.code(409).send({ error: 'Ordre du groupe verrouillé (1er match commencé).' });
    }
    const teamIds = db.prepare('SELECT id FROM teams WHERE group_letter = ?').all(letter).map(r => r.id);
    if (teamIds.length === 0) return reply.code(404).send({ error: 'Groupe inconnu' });

    const order = Array.isArray(req.body?.order) ? req.body.order.map(Number) : [];
    const valid = order.length === teamIds.length
      && new Set(order).size === order.length
      && order.every(id => teamIds.includes(id));
    if (!valid) return reply.code(400).send({ error: 'Classement invalide (les 4 équipes du groupe, sans doublon).' });

    db.prepare(`
      INSERT INTO group_order_predictions(user_id, group_letter, order_json, updated_at)
      VALUES(@uid, @letter, @order, @now)
      ON CONFLICT(user_id, group_letter) DO UPDATE SET
        order_json = excluded.order_json, updated_at = excluded.updated_at
    `).run({ uid: req.user.id, letter, order: JSON.stringify(order), now: new Date().toISOString() });

    if (getOfficialGroupOrder(letter)) recomputeGroupOrder(letter);
    return { ok: true };
  });
}

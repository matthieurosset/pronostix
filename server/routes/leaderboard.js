import { requireAuth } from '../auth.js';
import { leaderboard } from '../scoring.js';

export default async function leaderboardRoutes(app) {
  app.get('/api/leaderboard', { preHandler: requireAuth }, async (req) => {
    const rows = leaderboard();
    return {
      me: req.user.id,
      ranking: rows.map((r, i) => ({
        rank: i + 1,
        user_id: r.id,
        pseudo: r.pseudo,
        points: r.points,
        group_points: r.group_points,
        order_points: r.order_points,
        ko_points: r.ko_points,
        bonus_points: r.bonus_points,
        exact: r.exact_count,
        scored: r.scored_count,
      })),
    };
  });
}

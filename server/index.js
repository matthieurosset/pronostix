import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { db } from './db.js';
import { hashPin } from './auth.js';
import authRoutes from './routes/auth.js';
import matchRoutes from './routes/matches.js';
import groupRoutes from './routes/groups.js';
import leaderboardRoutes from './routes/leaderboard.js';
import bonusRoutes from './routes/bonus.js';
import adminRoutes from './routes/admin.js';
import { startFetcher } from './fetcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

/** Create or update the admin account from ADMIN_PSEUDO / ADMIN_PIN env vars. */
function ensureAdmin() {
  const pseudo = process.env.ADMIN_PSEUDO;
  const pin = process.env.ADMIN_PIN;
  if (!pseudo || !pin) return;
  const existing = db.prepare('SELECT * FROM users WHERE pseudo = ? COLLATE NOCASE').get(pseudo);
  if (existing) {
    db.prepare('UPDATE users SET pin_hash = ?, is_admin = 1 WHERE id = ?').run(hashPin(pin), existing.id);
  } else {
    db.prepare('INSERT INTO users(pseudo, pin_hash, is_admin, created_at) VALUES(?, ?, 1, ?)')
      .run(pseudo, hashPin(pin), new Date().toISOString());
  }
  app.log.info(`Admin "${pseudo}" prêt.`);
}

await app.register(authRoutes);
await app.register(matchRoutes);
await app.register(groupRoutes);
await app.register(leaderboardRoutes);
await app.register(bonusRoutes);
await app.register(adminRoutes);

await app.register(fastifyStatic, { root: join(__dirname, '..', 'public'), prefix: '/' });

// SPA fallback: any non-API, non-file route serves the app shell.
app.setNotFoundHandler((req, reply) => {
  if (req.raw.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
  return reply.sendFile('index.html');
});

ensureAdmin();
startFetcher(app.log);

await app.listen({ port: PORT, host: '0.0.0.0' });

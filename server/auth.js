import crypto from 'node:crypto';
import { db } from './db.js';

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id, created_at) VALUES(?, ?, ?)')
    .run(token, userId, new Date().toISOString());
  return token;
}

export function userFromToken(token) {
  if (!token) return null;
  return db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).get(token) || null;
}

/** Fastify preHandler: attaches req.user from the Bearer token (or null). */
export function attachUser(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  req.user = userFromToken(token);
}

export function requireAuth(req, reply, done) {
  attachUser(req);
  if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
  done();
}

export function requireAdmin(req, reply, done) {
  attachUser(req);
  if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
  if (!req.user.is_admin) return reply.code(403).send({ error: 'Réservé à l’admin' });
  done();
}

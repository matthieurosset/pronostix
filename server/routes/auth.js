import { db } from '../db.js';
import { hashPin, verifyPin, createSession, attachUser } from '../auth.js';

const PSEUDO_RE = /^[\p{L}0-9 _.\-]{2,20}$/u;
const PIN_RE = /^\d{4}$/;

export default async function authRoutes(app) {
  app.post('/api/auth/register', async (req, reply) => {
    const pseudo = (req.body?.pseudo || '').trim();
    const pin = String(req.body?.pin || '');
    if (!PSEUDO_RE.test(pseudo)) return reply.code(400).send({ error: 'Pseudo invalide (2 à 20 caractères).' });
    if (!PIN_RE.test(pin)) return reply.code(400).send({ error: 'Le PIN doit faire 4 chiffres.' });

    const exists = db.prepare('SELECT 1 FROM users WHERE pseudo = ? COLLATE NOCASE').get(pseudo);
    if (exists) return reply.code(409).send({ error: 'Ce pseudo est déjà pris.' });

    const info = db.prepare('INSERT INTO users(pseudo, pin_hash, is_admin, created_at) VALUES(?, ?, 0, ?)')
      .run(pseudo, hashPin(pin), new Date().toISOString());
    const token = createSession(info.lastInsertRowid);
    return { token, user: { id: info.lastInsertRowid, pseudo, is_admin: false } };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const pseudo = (req.body?.pseudo || '').trim();
    const pin = String(req.body?.pin || '');
    const user = db.prepare('SELECT * FROM users WHERE pseudo = ? COLLATE NOCASE').get(pseudo);
    if (!user || !verifyPin(pin, user.pin_hash)) {
      return reply.code(401).send({ error: 'Pseudo ou PIN incorrect.' });
    }
    const token = createSession(user.id);
    return { token, user: { id: user.id, pseudo: user.pseudo, is_admin: !!user.is_admin } };
  });

  app.get('/api/auth/me', async (req, reply) => {
    attachUser(req);
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return { user: { id: req.user.id, pseudo: req.user.pseudo, is_admin: !!req.user.is_admin } };
  });
}

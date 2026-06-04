// Seed teams + 104 matches from the committed openfootball snapshot.
// Idempotent: rows use explicit ids and INSERT OR IGNORE, so reruns (e.g. on every
// container boot) never duplicate data nor overwrite admin-entered results.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../server/db.js';
import { teamIso, teamFlag, teamNameFr } from '../server/teaminfo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'server', 'data');

const teamsRaw = JSON.parse(readFileSync(join(dataDir, 'teams2026.json'), 'utf8'));
const teams = Array.isArray(teamsRaw) ? teamsRaw : Object.values(teamsRaw);
const tournament = JSON.parse(readFileSync(join(dataDir, 'wc2026.json'), 'utf8'));

const STAGE = {
  'Round of 32': 'R32',
  'Round of 16': 'R16',
  'Quarter-final': 'QF',
  'Semi-final': 'SF',
  'Match for third place': '3RD',
  'Final': 'F',
};

function toUtcIso(date, timeStr) {
  const m = String(timeStr || '').match(/(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})/);
  const [Y, Mo, D] = date.split('-').map(Number);
  if (!m) return new Date(Date.UTC(Y, Mo - 1, D, 12, 0)).toISOString();
  const [, hh, mm, off] = m;
  const localAsUtc = Date.UTC(Y, Mo - 1, D, Number(hh), Number(mm));
  return new Date(localAsUtc - Number(off) * 3600_000).toISOString();
}

const insTeam = db.prepare(
  'INSERT OR IGNORE INTO teams(id, idx, name_fr, name_en, fifa_code, iso, flag, group_letter) VALUES(?,?,?,?,?,?,?,?)'
);
const idByName = new Map();
const seedTeams = db.transaction(() => {
  teams.forEach((t, i) => {
    const id = i + 1;
    insTeam.run(id, i, teamNameFr(t), t.name, t.fifa_code, teamIso(t), teamFlag(t), t.group);
    idByName.set(t.name, id);
  });
});
seedTeams();

const insMatch = db.prepare(`
  INSERT OR IGNORE INTO matches
    (id, num, stage, group_letter, matchday, kickoff_utc, ground,
     home_team_id, away_team_id, home_label, away_label)
  VALUES (@id, @num, @stage, @group, @matchday, @kickoff, @ground,
          @home_id, @away_id, @home_label, @away_label)
`);

const seedMatches = db.transaction(() => {
  tournament.matches.forEach((m, i) => {
    const stage = STAGE[m.round] || 'group';
    const isGroup = stage === 'group';
    const homeId = isGroup ? (idByName.get(m.team1) ?? null) : null;
    const awayId = isGroup ? (idByName.get(m.team2) ?? null) : null;
    insMatch.run({
      id: i + 1,
      num: m.num ?? null,
      stage,
      group: m.group ? m.group.replace(/^Group\s+/, '') : null,
      matchday: m.round,
      kickoff: toUtcIso(m.date, m.time),
      ground: m.ground || null,
      home_id: homeId,
      away_id: awayId,
      home_label: isGroup ? null : m.team1,
      away_label: isGroup ? null : m.team2,
    });
  });
});
seedMatches();

const tc = db.prepare('SELECT COUNT(*) c FROM teams').get().c;
const mc = db.prepare('SELECT COUNT(*) c FROM matches').get().c;
const gc = db.prepare("SELECT COUNT(*) c FROM matches WHERE stage='group'").get().c;
console.log(`Seed OK — ${tc} équipes, ${mc} matchs (${gc} de poules, ${mc - gc} à élimination directe).`);

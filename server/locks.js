import { db } from './db.js';

export const LOCK_LEAD_MS = 15 * 60 * 1000; // matches lock 15 min before kickoff

export function matchKickoffMs(match) {
  return new Date(match.kickoff_utc).getTime();
}

/** A match prediction locks 15 minutes before kickoff. */
export function isMatchLocked(match, now = Date.now()) {
  return now >= matchKickoffMs(match) - LOCK_LEAD_MS;
}

/** Earliest kickoff among a group's matches (group order locks then). */
export function groupFirstKickoffMs(letter) {
  const row = db.prepare(
    "SELECT MIN(kickoff_utc) AS k FROM matches WHERE group_letter = ? AND stage = 'group'"
  ).get(letter);
  return row && row.k ? new Date(row.k).getTime() : Infinity;
}

export function isGroupOrderLocked(letter, now = Date.now()) {
  return now >= groupFirstKickoffMs(letter);
}

/** Tournament kickoff = earliest match overall; bonus predictions lock then. */
export function tournamentStartMs() {
  const row = db.prepare('SELECT MIN(kickoff_utc) AS k FROM matches').get();
  return row && row.k ? new Date(row.k).getTime() : Infinity;
}

export function isBonusLocked(now = Date.now()) {
  return now >= tournamentStartMs();
}

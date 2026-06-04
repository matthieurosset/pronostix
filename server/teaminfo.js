import { FR_NAMES, FLAG_OVERRIDE } from './data/fr-names.js';

/** Derive an ISO 3166-1 alpha-2 code from a flag emoji (regional indicators). */
export function isoFromEmoji(s) {
  const cps = [...String(s || '')].map(c => c.codePointAt(0));
  const ri = cps.filter(c => c >= 0x1f1e6 && c <= 0x1f1ff);
  if (ri.length === 2) return ri.map(c => String.fromCharCode(c - 0x1f1e6 + 97)).join('');
  return null; // subdivision flag (e.g. England, Scotland)
}

export function teamIso(team) {
  return FLAG_OVERRIDE[team.name] || isoFromEmoji(team.flag_icon);
}

export function teamFlag(team) {
  const iso = teamIso(team);
  return iso ? `${iso}.svg` : null;
}

export function teamNameFr(team) {
  return FR_NAMES[team.name] || team.name;
}

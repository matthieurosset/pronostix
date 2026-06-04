// One-time: populate public/flags/ with the SVGs needed for the 48 teams.
// 46 come from the Mission Géo asset library (by ISO code); England & Scotland
// (subdivision flags) are fetched from lipis/flag-icons (MIT). Run once locally
// and commit the result so the Docker image is self-contained.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { teamIso } from '../server/teaminfo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const SRC = process.env.FLAGS_SRC || '/home/mrjack/git/mission-geo/assets/world/flags_svg';
const DEST = join(root, 'public', 'flags');
mkdirSync(DEST, { recursive: true });

const teams = JSON.parse(readFileSync(join(root, 'server', 'data', 'teams2026.json'), 'utf8'));
const list = Array.isArray(teams) ? teams : Object.values(teams);

let copied = 0;
const fetchList = [];
for (const team of list) {
  const iso = teamIso(team);
  if (!iso) { console.warn(`! pas d'ISO pour ${team.name}`); continue; }
  const dest = join(DEST, `${iso}.svg`);
  if (existsSync(dest)) { copied++; continue; }
  const src = join(SRC, `${iso}.svg`);
  if (existsSync(src)) { copyFileSync(src, dest); copied++; }
  else fetchList.push(iso);
}

// Download anything missing (England/Scotland, or ISO not in Mission Géo) from lipis/flag-icons.
for (const iso of fetchList) {
  const url = `https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/${iso}.svg`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(join(DEST, `${iso}.svg`), await res.text());
    console.log(`↓ téléchargé ${iso}.svg`);
    copied++;
  } catch (e) {
    console.error(`✗ impossible de récupérer ${iso}.svg: ${e.message}`);
  }
}

console.log(`Drapeaux prêts: ${copied}/${list.length} dans public/flags/`);

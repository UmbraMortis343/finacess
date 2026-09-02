// Generates data.js from the four IMF FAS CSVs (DBnomics wide export).
// Usage: node build-data.js
// Centroids + regions come from the REST Countries API, fetched once at build
// time and cached in centroids-cache.json. The generated data.js has no
// runtime fetches — everything is inlined.

const fs = require('fs');
const path = require('path');

const YEAR_MIN = 2004;
const YEAR_MAX = 2024;
const YEARS = [];
for (let y = YEAR_MIN; y <= YEAR_MAX; y++) YEARS.push(y);

const FILES = {
  atms: 'fas-atms.csv',
  branches: 'fas-branches.csv',
  mmAgents: 'fas-mm-agents.csv',
  mmAccounts: 'fas-mm-accounts.csv',
};

const CACHE_FILE = path.join(__dirname, 'centroids-cache.json');
const CENTROID_URL =
  'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';

// --- CSV parsing (same approach as coverage-report.js) ---

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseHeaderCell(cell) {
  const iso = (cell.match(/\(IMF\/FAS\/A\.([A-Z0-9]+)\./) || [])[1] || null;
  const parts = cell.split(/\s+[–—-]\s+/);
  const name = parts.length >= 2 ? parts[1].trim() : cell;
  return { iso, name };
}

// Returns Map<iso, { name, values: Map<year, number> }>
function loadFile(file) {
  const text = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const cols = parseCsvLine(lines[0]).slice(1).map(parseHeaderCell);
  const byIso = new Map();
  for (const c of cols) {
    if (c.iso) byIso.set(c.iso, { name: c.name, values: new Map() });
  }
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const year = parseInt(cells[0], 10);
    if (!Number.isFinite(year) || year < YEAR_MIN || year > YEAR_MAX) continue;
    for (let i = 1; i < cells.length; i++) {
      const raw = cells[i].trim();
      if (raw === '' || raw === 'NA' || raw === 'NaN') continue;
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      const col = cols[i - 1];
      if (col && col.iso) byIso.get(col.iso).values.set(year, v);
    }
  }
  return byIso;
}

// --- Centroids / regions ---

async function getCentroids() {
  if (fs.existsSync(CACHE_FILE)) {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
  console.error('Fetching centroids from mledoze/countries...');
  const res = await fetch(CENTROID_URL);
  if (!res.ok) throw new Error(`Centroid fetch failed: ${res.status}`);
  const list = await res.json();
  const map = {};
  for (const c of list) {
    if (c.cca2 && Array.isArray(c.latlng) && c.latlng.length === 2) {
      map[c.cca2] = {
        lat: c.latlng[0],
        lon: c.latlng[1],
        region: c.region || null,
        area: typeof c.area === 'number' ? c.area : null,
      };
    }
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(map, null, 1));
  return map;
}

// --- Build ---

const round2 = (v) => Math.round(v * 100) / 100;

async function main() {
  const data = {};
  for (const [key, file] of Object.entries(FILES)) data[key] = loadFile(file);

  const centroids = await getCentroids();

  // Union of countries across the three source files.
  const isoName = new Map();
  for (const m of Object.values(data)) {
    for (const [iso, { name }] of m) if (!isoName.has(iso)) isoName.set(iso, name);
  }

  const missing = [];
  const countries = [];
  for (const [iso2, name] of [...isoName.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
    const geo = centroids[iso2];
    if (!geo) missing.push(`${name} (${iso2})`);

    const series = {};
    const max = {};
    for (const key of Object.keys(FILES)) {
      const entry = data[key].get(iso2);
      const arr = YEARS.map((y) => {
        const v = entry ? entry.values.get(y) : undefined;
        return v === undefined ? null : round2(v);
      });
      series[key] = arr;
      const present = arr.filter((v) => v !== null);
      max[key] = present.length ? Math.max(...present) : null;
    }

    const hasPhysical = max.atms !== null || max.branches !== null;
    const hasMM = max.mmAccounts !== null || max.mmAgents !== null;
    const coverage = hasPhysical && hasMM ? 'both' : hasPhysical ? 'physical-only' : 'none';
    if (!hasPhysical && hasMM) console.error(`WARNING: ${name} has mobile money but no physical data`);

    countries.push({
      name,
      iso2,
      lat: geo ? round2(geo.lat) : null,
      lon: geo ? round2(geo.lon) : null,
      region: geo ? geo.region : null,
      area: geo ? geo.area : null,
      coverage,
      years: YEARS,
      atms: series.atms,
      branches: series.branches,
      mmAgents: series.mmAgents,
      mmAccounts: series.mmAccounts,
      max,
    });
  }

  const globalMax = {};
  for (const key of Object.keys(FILES)) {
    globalMax[key] = round2(Math.max(...countries.map((c) => c.max[key]).filter((v) => v !== null)));
  }

  const payload = {
    source: 'IMF Financial Access Survey via DBnomics',
    generated: new Date().toISOString().slice(0, 10),
    yearMin: YEAR_MIN,
    yearMax: YEAR_MAX,
    globalMax,
    countries,
  };

  const js =
    '// Generated by build-data.js — do not edit by hand.\n' +
    '// Source: IMF Financial Access Survey (DBnomics export). Nulls = not reported.\n' +
    'window.FAS_DATA = ' + JSON.stringify(payload) + ';\n';

  fs.writeFileSync(path.join(__dirname, 'data.js'), js, 'utf8');

  const counts = { both: 0, 'physical-only': 0, none: 0 };
  for (const c of countries) counts[c.coverage]++;
  console.error(`Wrote data.js: ${countries.length} countries, ${(js.length / 1024).toFixed(0)} KB`);
  console.error(`Coverage: both=${counts.both}, physical-only=${counts['physical-only']}, none=${counts.none}`);
  console.error(`Global max: atms=${globalMax.atms}, branches=${globalMax.branches}, mmAgents=${globalMax.mmAgents}, mmAccounts=${globalMax.mmAccounts}`);
  if (missing.length) console.error(`NO CENTROID for: ${missing.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

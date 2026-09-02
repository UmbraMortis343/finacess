// Coverage report for the four IMF FAS CSVs (DBnomics wide export).
// Usage: node coverage-report.js
// Dev tooling only — not part of the deployed app.

const fs = require('fs');
const path = require('path');

const YEAR_MIN = 2004;
const YEAR_MAX = 2024;
const N_YEARS = YEAR_MAX - YEAR_MIN + 1; // 21

// "Good" thresholds: traditional series run the full window; mobile money
// only exists from ~2010 in FAS, so a lower bar is appropriate there.
const TRAD_GOOD = 15; // years out of 21, required on BOTH atms and branches
const MM_GOOD = 8;    // years, required on at least ONE mobile money series

const FILES = {
  atms: 'fas-atms.csv',
  branches: 'fas-branches.csv',
  mmAccounts: 'fas-mm-accounts.csv',
  mmAgents: 'fas-mm-agents.csv',
};

// Minimal CSV line parser handling quoted fields with embedded commas.
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

// Header cells look like:
// Annual – Andorra – Key Indicators, ... (IMF/FAS/A.AD.FCAA_NUM)
function parseHeaderCell(cell) {
  const iso = (cell.match(/\(IMF\/FAS\/A\.([A-Z0-9]+)\./) || [])[1] || null;
  // Country sits between the first and second dash separators (en dash or hyphen).
  const parts = cell.split(/\s+[–—-]\s+/);
  const name = parts.length >= 2 ? parts[1].trim() : cell;
  return { iso, name };
}

// Returns Map<iso, { name, years: Set<number> }>
function loadFile(file) {
  const text = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = parseCsvLine(lines[0]);
  const cols = header.slice(1).map(parseHeaderCell);
  const byIso = new Map();
  for (const c of cols) {
    if (c.iso) byIso.set(c.iso, { name: c.name, years: new Set() });
  }
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const year = parseInt(cells[0], 10);
    if (!Number.isFinite(year) || year < YEAR_MIN || year > YEAR_MAX) continue;
    for (let i = 1; i < cells.length; i++) {
      const v = cells[i].trim();
      if (v === '' || v === 'NA' || v === 'NaN') continue;
      const col = cols[i - 1];
      if (col && col.iso) byIso.get(col.iso).years.add(year);
    }
  }
  return byIso;
}

const data = {};
for (const [key, file] of Object.entries(FILES)) data[key] = loadFile(file);

// Union of all countries across the four files.
const countries = new Map(); // iso -> name
for (const m of Object.values(data)) {
  for (const [iso, { name }] of m) if (!countries.has(iso)) countries.set(iso, name);
}

const rows = [];
for (const [iso, name] of countries) {
  const c = {};
  for (const key of Object.keys(FILES)) {
    const entry = data[key].get(iso);
    c[key] = entry ? entry.years.size : 0;
  }
  const combined = c.atms + c.branches + c.mmAccounts + c.mmAgents;
  const flagged =
    c.atms >= TRAD_GOOD && c.branches >= TRAD_GOOD &&
    (c.mmAccounts >= MM_GOOD || c.mmAgents >= MM_GOOD);
  rows.push({ iso, name, ...c, combined, flagged });
}

rows.sort((a, b) => b.combined - a.combined || a.name.localeCompare(b.name));

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log(`Coverage ${YEAR_MIN}-${YEAR_MAX} (max ${N_YEARS} years per indicator)`);
console.log(`Flag (*): ATMs & branches >= ${TRAD_GOOD} yrs AND (MM accounts or MM agents) >= ${MM_GOOD} yrs\n`);
console.log(pad('', 2) + pad('ISO', 5) + pad('Country', 34) + num('ATMs', 6) + num('Brnch', 7) + num('MMacc', 7) + num('MMagt', 7) + num('Total', 7));
console.log('-'.repeat(75));
for (const r of rows) {
  console.log(
    pad(r.flagged ? '*' : '', 2) + pad(r.iso, 5) + pad(r.name.slice(0, 32), 34) +
    num(r.atms, 6) + num(r.branches, 7) + num(r.mmAccounts, 7) + num(r.mmAgents, 7) + num(r.combined, 7)
  );
}

const flaggedRows = rows.filter((r) => r.flagged);
console.log(`\n${rows.length} countries total; ${flaggedRows.length} flagged as good on traditional + mobile money:`);
console.log(flaggedRows.map((r) => `${r.name} (${r.iso})`).join(', '));

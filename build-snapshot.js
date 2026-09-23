#!/usr/bin/env node
// Builds data.json from a local clone of rsksmart/RSKIPs.
// Usage: node build-snapshot.js /path/to/RSKIPs
//
// - Stores each file's git blob SHA so the site only re-downloads proposals that changed.
// - Leaves data.json untouched when nothing changed (no empty daily commits).
// - Skips individual bad files (symlinks, oversized, unparseable) with a warning, and refuses to
//   write if the upstream repo suddenly looks broken, so a bad day upstream can't wipe the snapshot.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseRskip, parseAuthorIndex, isRskipFile } = require('./rskip.js');

const repo = process.argv[2];
if (!repo) { console.error('Usage: node build-snapshot.js /path/to/RSKIPs'); process.exit(2); }

const out = path.join(__dirname, 'data.json');
const MAX_FILE_BYTES = 1_000_000; // RSKIPs are a few KB; anything huge is not a proposal
const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

// Read only regular files: a symlink in the upstream repo could otherwise point at runner files
// (e.g. .git/config) and publish their contents, or at /dev/zero and hang the job.
function readRegular(p) {
  const st = fs.lstatSync(p);
  if (!st.isFile()) throw new Error(`not a regular file: ${p}`);
  if (st.size > MAX_FILE_BYTES) throw new Error(`too large (${st.size} bytes): ${p}`);
  return fs.readFileSync(p);
}

const ipsDir = path.join(repo, 'IPs');
if (!fs.lstatSync(ipsDir).isDirectory()) { console.error('IPs is not a directory'); process.exit(1); }
const readmeBuf = readRegular(path.join(repo, 'README.md'));
const names = parseAuthorIndex(readmeBuf.toString('utf8'));

const skipped = [];
const items = fs.readdirSync(ipsDir)
  .map((f) => `IPs/${f}`)
  .filter(isRskipFile)
  .flatMap((p) => {
    try {
      const buf = readRegular(path.join(repo, p));
      const item = { ...parseRskip(p, buf.toString('utf8'), names), sha: blobSha(buf) };
      if (!Number.isInteger(item.num)) throw new Error(`no RSKIP number: ${p}`);
      return [item];
    } catch (e) {
      skipped.push(e.message);
      return [];
    }
  })
  .sort((a, b) => a.num - b.num || a.path.localeCompare(b.path));
for (const msg of skipped) console.warn(`Skipped ${msg}`);

let old = null;
try { old = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* first run */ }

// Sanity check before overwriting anything: one bad upstream file is skipped, a broken repo is refused.
if (old?.items?.length && items.length < old.items.length * 0.9) {
  console.error(`Refusing to write: ${items.length} proposals, previously ${old.items.length}.`);
  process.exit(1);
}

const next = { readmeSha: blobSha(readmeBuf), names, items };
const same = old && JSON.stringify({ readmeSha: old.readmeSha, names: old.names, items: old.items }) === JSON.stringify(next);
if (same) {
  console.log(`${items.length} RSKIPs, no changes`);
} else {
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), ...next }));
  console.log(`${items.length} RSKIPs, data.json updated`);
}

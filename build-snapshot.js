// Builds data.json from a local clone of rsksmart/RSKIPs (fallback if live GitHub fetch fails).
// Usage: node build-snapshot.js /path/to/RSKIPs
// Only rewrites data.json when the proposals actually changed, so the daily job doesn't make empty commits.
const fs = require('fs');
const path = require('path');
const { parseRskip, parseAuthorIndex, isRskipFile } = require('./rskip.js');

const repo = process.argv[2];
const out = path.join(__dirname, 'data.json');
const names = parseAuthorIndex(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'));
const items = fs.readdirSync(path.join(repo, 'IPs'))
  .map((f) => 'IPs/' + f)
  .filter(isRskipFile)
  .map((p) => parseRskip(p, fs.readFileSync(path.join(repo, p), 'utf8'), names))
  .sort((a, b) => a.num - b.num);

let old = null;
try { old = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) {}
if (old && JSON.stringify(old.items) === JSON.stringify(items)) {
  console.log(items.length, 'RSKIPs, no changes');
} else {
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), items }));
  console.log(items.length, 'RSKIPs, data.json updated');
}

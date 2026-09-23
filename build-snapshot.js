// Builds data.json from a local clone of rsksmart/RSKIPs (fallback if live GitHub fetch fails).
// Usage: node build-snapshot.js /path/to/RSKIPs
const fs = require('fs');
const path = require('path');
const { parseRskip, parseAuthorIndex, isRskipFile } = require('./rskip.js');

const repo = process.argv[2];
const names = parseAuthorIndex(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'));
const items = fs.readdirSync(path.join(repo, 'IPs'))
  .map((f) => 'IPs/' + f)
  .filter(isRskipFile)
  .map((p) => parseRskip(p, fs.readFileSync(path.join(repo, p), 'utf8'), names))
  .sort((a, b) => a.num - b.num);
fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify({ generated: new Date().toISOString(), items }));
console.log(items.length, 'RSKIPs');
